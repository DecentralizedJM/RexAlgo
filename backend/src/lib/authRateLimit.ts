/**
 * Per-IP fixed-window rate limit for authentication endpoints.
 *
 * Built to mirror {@link ../copyWebhookRateLimit} — same Redis INCR + PEXPIRE
 * pipeline, same in-memory fallback for single-instance dev. Different budgets
 * per endpoint class:
 *
 *   login   →  5 / minute   (Mudrex-secret login + future legacy endpoints)
 *   google  → 10 / minute   (Google id-token verification proxies to Google)
 *   tg      → 20 / minute   (Telegram start + poll — benign polling is ~40/min
 *                             per user, so the cap is per-IP not per-token)
 *
 * We fail OPEN on Redis errors to avoid locking real users out during a brief
 * Redis outage; the in-memory fallback is sufficient for the single-replica
 * local case.
 */
import { getRedis } from "@/lib/redis";

export type AuthLimitBucket = "login" | "google" | "tg";

const WINDOW_MS = 60_000;

const LIMITS: Record<AuthLimitBucket, number> = {
  login: 5,
  google: 10,
  tg: 20,
};

const local = new Map<string, { count: number; resetAt: number }>();

function bucketKey(bucket: AuthLimitBucket, ip: string): string {
  return `${bucket}:${ip}`;
}

function checkLocal(bucket: AuthLimitBucket, ip: string, now: number): boolean {
  const key = bucketKey(bucket, ip);
  const b = local.get(key);
  if (!b || now >= b.resetAt) {
    local.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= LIMITS[bucket]) return false;
  b.count += 1;
  return true;
}

function redisKey(
  bucket: AuthLimitBucket,
  ip: string,
  windowStart: number
): string {
  return `rexalgo:authrl:${bucket}:${ip}:${windowStart}`;
}

/**
 * Returns `true` when the request is within the budget, `false` when the
 * caller should respond with 429. Safe to call with `ip === "unknown"`; it
 * will still enforce a single shared bucket for requests without a
 * trustworthy client IP.
 */
export async function checkAuthRateLimit(
  bucket: AuthLimitBucket,
  ip: string
): Promise<boolean> {
  const now = Date.now();
  const redis = getRedis();
  const safeIp = ip?.trim() || "unknown";
  if (!redis) return checkLocal(bucket, safeIp, now);

  const windowStart = now - (now % WINDOW_MS);
  const key = redisKey(bucket, safeIp, windowStart);
  try {
    const results = await redis
      .multi()
      .incr(key)
      .pexpire(key, WINDOW_MS + 1_000)
      .exec();
    if (!results) return true;
    const first = results[0];
    if (!first || first[0]) return true;
    const count = Number(first[1]);
    if (!Number.isFinite(count)) return true;
    return count <= LIMITS[bucket];
  } catch (err) {
    console.warn("[authRateLimit] redis check failed, allowing:", err);
    return true;
  }
}

/** Extract the best-effort client IP from standard Next.js proxy headers. */
export function clientIpFromRequest(req: {
  headers: { get: (name: string) => string | null };
}): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Response body + 429 headers for callers. */
export function authRateLimitResponse(): {
  body: { error: string; code: string };
  status: 429;
  headers: Record<string, string>;
} {
  return {
    body: {
      error: "Too many requests. Slow down and try again shortly.",
      code: "RATE_LIMITED",
    },
    status: 429,
    headers: { "Retry-After": "60" },
  };
}
