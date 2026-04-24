/**
 * Client-side rate limiter for outbound Mudrex traffic.
 *
 * Mudrex (docs v1.0.5) enforces per-API-key caps split across two tiers:
 *
 *   Enhanced  —  5 req/s,  125 req/min,  2 500 req/hour,  25 000 req/day
 *   Standard  —  2 req/s,   50 req/min,  1 000 req/hour,  10 000 req/day
 *
 * Enhanced tier matches the official “selected endpoints” list (same numeric
 * caps as v1.0.4). We map each outbound path under `/fapi/v1` to Enhanced when
 * it corresponds to:
 *   Create order · Cancel order · Add/reduce margin · Set/edit SL/TP (riskorder)
 *   · Reverse · Partial close · Square off (full close) · Get/set leverage
 *
 * Regex mapping (path = portion after `/fapi/v1`, query stripped):
 *   POST   /futures/:id/order
 *   DELETE /futures/orders/:id
 *   POST   /futures/positions/:id/add-margin
 *   POST   /futures/positions/:id/riskorder
 *   PATCH  /futures/positions/:id/riskorder
 *   POST   /futures/positions/:id/reverse
 *   POST   /futures/positions/:id/close/partial
 *   POST   /futures/positions/:id/close
 *   GET    /futures/:id/leverage
 *   POST   /futures/:id/leverage
 *
 * Everything else (wallet, asset list, open orders list, liq-price, …) is Standard.
 *
 * Design:
 * - In-memory sliding-window limiter with per-(apiKey, tier) state and a FIFO
 *   waiter queue. A single "pump" worker per key processes waiters so there is
 *   no starvation under bursts.
 * - Exposed behind a small `MudrexRateLimiter` interface so we can swap in a
 *   Redis-backed implementation later without touching callers.
 *
 * @see https://docs.trade.mudrex.com/docs/authentication-rate-limits
 * @see https://docs.trade.mudrex.com/docs/changelogs
 */

export type MudrexTier = "enhanced" | "standard";

export type MudrexRateLimitContext = "interactive" | "background";

export interface MudrexAcquireOptions {
  maxWaitMs?: number;
  signal?: AbortSignal;
}

export interface MudrexRateLimiter {
  acquire(
    apiKey: string,
    tier: MudrexTier,
    opts?: MudrexAcquireOptions
  ): Promise<void>;
  /** Mark `n` tokens consumed without a request (used when Mudrex itself returns 429). */
  penalise(apiKey: string, tier: MudrexTier, n?: number): void;
}

export class MudrexRateLimitExceededError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(
      `Mudrex client-side rate limit exceeded; retry in ~${Math.ceil(
        retryAfterMs / 1000
      )}s`
    );
    this.name = "MudrexRateLimitExceededError";
  }
}

export class MudrexRateLimitAbortedError extends Error {
  constructor() {
    super("Mudrex rate-limit wait aborted");
    this.name = "MudrexRateLimitAbortedError";
  }
}

// ─── Config ──────────────────────────────────────────────────────────

interface TierLimits {
  perSec: number;
  perMin: number;
  perHour: number;
  perDay: number;
}

interface RateLimiterConfig {
  enhanced: TierLimits;
  standard: TierLimits;
  /** Default max wait for interactive callers (e.g. user route). */
  maxWaitInteractiveMs: number;
  /** Default max wait for background callers (copy-mirror, TradingView webhook, pagination). */
  maxWaitBackgroundMs: number;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadConfig(): RateLimiterConfig {
  return {
    enhanced: {
      perSec: intFromEnv("MUDREX_RL_ENHANCED_PER_SEC", 5),
      perMin: intFromEnv("MUDREX_RL_ENHANCED_PER_MIN", 125),
      perHour: intFromEnv("MUDREX_RL_ENHANCED_PER_HOUR", 2500),
      perDay: intFromEnv("MUDREX_RL_ENHANCED_PER_DAY", 25000),
    },
    standard: {
      perSec: intFromEnv("MUDREX_RL_STANDARD_PER_SEC", 2),
      perMin: intFromEnv("MUDREX_RL_STANDARD_PER_MIN", 50),
      perHour: intFromEnv("MUDREX_RL_STANDARD_PER_HOUR", 1000),
      perDay: intFromEnv("MUDREX_RL_STANDARD_PER_DAY", 10000),
    },
    maxWaitInteractiveMs: intFromEnv("MUDREX_RL_MAX_WAIT_INTERACTIVE_MS", 3000),
    maxWaitBackgroundMs: intFromEnv("MUDREX_RL_MAX_WAIT_BACKGROUND_MS", 60000),
  };
}

export function defaultMaxWaitMs(ctx: MudrexRateLimitContext): number {
  const cfg = loadConfig();
  return ctx === "background"
    ? cfg.maxWaitBackgroundMs
    : cfg.maxWaitInteractiveMs;
}

// ─── Tier classification ─────────────────────────────────────────────

type EndpointRule = {
  method: string;
  /** Regex matched against the path portion of the endpoint (no query string). */
  pattern: RegExp;
};

/** Paths here are Enhanced; everything else is Standard. Path is the portion after /fapi/v1. */
const ENHANCED_RULES: EndpointRule[] = [
  // POST /futures/:id/order
  { method: "POST", pattern: /^\/futures\/[^/]+\/order$/ },
  // DELETE /futures/orders/:id
  { method: "DELETE", pattern: /^\/futures\/orders\/[^/]+$/ },
  // POST /futures/positions/:id/add-margin
  { method: "POST", pattern: /^\/futures\/positions\/[^/]+\/add-margin$/ },
  // POST/PATCH /futures/positions/:id/riskorder
  { method: "POST", pattern: /^\/futures\/positions\/[^/]+\/riskorder$/ },
  { method: "PATCH", pattern: /^\/futures\/positions\/[^/]+\/riskorder$/ },
  // POST /futures/positions/:id/reverse
  { method: "POST", pattern: /^\/futures\/positions\/[^/]+\/reverse$/ },
  // POST /futures/positions/:id/close/partial  and  /close
  { method: "POST", pattern: /^\/futures\/positions\/[^/]+\/close\/partial$/ },
  { method: "POST", pattern: /^\/futures\/positions\/[^/]+\/close$/ },
  // GET/POST /futures/:id/leverage
  { method: "GET", pattern: /^\/futures\/[^/]+\/leverage$/ },
  { method: "POST", pattern: /^\/futures\/[^/]+\/leverage$/ },
];

/**
 * Classify an outbound Mudrex endpoint into an Enhanced or Standard tier.
 *
 * @param method    HTTP method (GET/POST/PATCH/DELETE …). Defaults to GET.
 * @param endpoint  Endpoint relative to `/fapi/v1` (may include a query string).
 */
export function classifyTier(
  method: string | undefined,
  endpoint: string
): MudrexTier {
  const m = (method ?? "GET").toUpperCase();
  const path = endpoint.split("?")[0];
  // Special case: /futures/positions/:id/liq-price is Standard (not in the Enhanced list).
  // Anything not matched below is Standard by default.
  for (const rule of ENHANCED_RULES) {
    if (rule.method === m && rule.pattern.test(path)) return "enhanced";
  }
  return "standard";
}

// ─── In-memory limiter implementation ────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Waiter = {
  resolve: () => void;
  reject: (err: Error) => void;
  deadline: number;
  signal?: AbortSignal;
  onAbort?: () => void;
};

class TierBucket {
  private tsSec: number[] = [];
  private tsMin: number[] = [];
  private tsHour: number[] = [];
  private tsDay: number[] = [];
  private waiters: Waiter[] = [];
  private pumping = false;

  constructor(private readonly limits: TierLimits) {}

  async acquire(maxWaitMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new MudrexRateLimitAbortedError();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        deadline: Date.now() + Math.max(0, maxWaitMs),
        signal,
      };

      if (signal) {
        waiter.onAbort = () => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) {
            this.waiters.splice(i, 1);
            reject(new MudrexRateLimitAbortedError());
          }
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }

      this.waiters.push(waiter);
      void this.pump();
    });
  }

  /** Record `n` fake consumed tokens without issuing a real request. */
  penalise(n: number): void {
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      this.tsSec.push(now);
      this.tsMin.push(now);
      this.tsHour.push(now);
      this.tsDay.push(now);
    }
  }

  private trim(now: number): void {
    while (this.tsSec.length && this.tsSec[0] <= now - 1_000) this.tsSec.shift();
    while (this.tsMin.length && this.tsMin[0] <= now - 60_000) this.tsMin.shift();
    while (this.tsHour.length && this.tsHour[0] <= now - 3_600_000)
      this.tsHour.shift();
    while (this.tsDay.length && this.tsDay[0] <= now - 86_400_000)
      this.tsDay.shift();
  }

  /**
   * Milliseconds until ALL windows have at least one free slot.
   * Returns 0 if we can acquire immediately. Assumes `trim` was called.
   */
  private earliestFreeMs(now: number): number {
    let wait = 0;
    if (this.tsSec.length >= this.limits.perSec) {
      wait = Math.max(wait, this.tsSec[0] + 1_000 - now);
    }
    if (this.tsMin.length >= this.limits.perMin) {
      wait = Math.max(wait, this.tsMin[0] + 60_000 - now);
    }
    if (this.tsHour.length >= this.limits.perHour) {
      wait = Math.max(wait, this.tsHour[0] + 3_600_000 - now);
    }
    if (this.tsDay.length >= this.limits.perDay) {
      wait = Math.max(wait, this.tsDay[0] + 86_400_000 - now);
    }
    return Math.max(0, wait);
  }

  private finalize(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length > 0) {
        const w = this.waiters[0];

        if (w.signal?.aborted) {
          this.waiters.shift();
          this.finalize(w);
          w.reject(new MudrexRateLimitAbortedError());
          continue;
        }

        const now = Date.now();
        this.trim(now);
        const wait = this.earliestFreeMs(now);

        if (wait <= 0) {
          this.tsSec.push(now);
          this.tsMin.push(now);
          this.tsHour.push(now);
          this.tsDay.push(now);
          this.waiters.shift();
          this.finalize(w);
          w.resolve();
          continue;
        }

        const remaining = w.deadline - now;
        if (wait > remaining) {
          this.waiters.shift();
          this.finalize(w);
          w.reject(new MudrexRateLimitExceededError(wait));
          continue;
        }

        // Sleep up to the shortest of: needed wait, remaining time, 500ms (to
        // stay responsive to cancellations), then re-evaluate.
        const sleepMs = Math.min(wait, remaining, 500) + 1;
        await sleep(sleepMs);
      }
    } finally {
      this.pumping = false;
    }
  }
}

class InMemoryMudrexRateLimiter implements MudrexRateLimiter {
  private buckets = new Map<string, TierBucket>();

  constructor(private readonly config: RateLimiterConfig) {}

  private bucketFor(apiKey: string, tier: MudrexTier): TierBucket {
    const key = `${tier}:${apiKey}`;
    let b = this.buckets.get(key);
    if (!b) {
      const limits =
        tier === "enhanced" ? this.config.enhanced : this.config.standard;
      b = new TierBucket(limits);
      this.buckets.set(key, b);
    }
    return b;
  }

  async acquire(
    apiKey: string,
    tier: MudrexTier,
    opts?: MudrexAcquireOptions
  ): Promise<void> {
    const maxWait =
      opts?.maxWaitMs ?? this.config.maxWaitInteractiveMs;
    await this.bucketFor(apiKey, tier).acquire(maxWait, opts?.signal);
  }

  penalise(apiKey: string, tier: MudrexTier, n: number = 1): void {
    this.bucketFor(apiKey, tier).penalise(Math.max(1, n | 0));
  }
}

// ─── Singleton (lazy) ────────────────────────────────────────────────

type GlobalWithLimiter = typeof globalThis & {
  __mudrexRateLimiter?: MudrexRateLimiter;
};

/**
 * Returns the process-wide limiter instance. Config is loaded once per process
 * (env vars read on first call). To swap in a Redis-backed limiter later,
 * replace this factory — no caller changes required.
 */
export function getMudrexRateLimiter(): MudrexRateLimiter {
  const g = globalThis as GlobalWithLimiter;
  if (!g.__mudrexRateLimiter) {
    g.__mudrexRateLimiter = new InMemoryMudrexRateLimiter(loadConfig());
  }
  return g.__mudrexRateLimiter;
}
