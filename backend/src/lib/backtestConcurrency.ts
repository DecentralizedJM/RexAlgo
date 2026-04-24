/**
 * Per-user concurrency cap for strategy backtests (audit #14).
 *
 * Backtests can be CPU-heavy (multiple years of OHLC + indicator evaluation),
 * so a single user hammering the button can starve the API for everyone else.
 * This limiter enforces at most {@link MAX_CONCURRENT_BACKTESTS_PER_USER} in
 * flight per user across all API replicas.
 *
 * Implementation:
 *   - When `REDIS_URL` is configured we use `INCR` + `EXPIRE` (TTL as a
 *     crash-safety net) so the limit is process-global.
 *   - Without Redis we fall back to an in-process `Map`. This is fine for
 *     single-node dev but will under-count across Railway replicas — we
 *     intentionally log a warning the first time that fallback fires so it
 *     is visible in production logs if someone misconfigures the service.
 *
 * Usage:
 *   ```ts
 *   const lease = await acquireBacktestSlot(userId);
 *   if (!lease.ok) return NextResponse.json({ error: lease.reason }, { status: 429 });
 *   try { ... } finally { await lease.release(); }
 *   ```
 * The release must run in a `finally` so crashes/throws do not leak slots.
 */
import { getRedis } from "@/lib/redis";

export const MAX_CONCURRENT_BACKTESTS_PER_USER = Number.parseInt(
  process.env.REXALGO_MAX_CONCURRENT_BACKTESTS_PER_USER ?? "3",
  10
);

/**
 * TTL on the Redis counter — long enough to cover a realistic backtest
 * (30s is the p99 we have seen) with generous headroom, short enough that a
 * crashed request does not permanently block a user. The limiter calls
 * `DECR` in `finally`; this TTL is only the safety net for crashes.
 */
const REDIS_SLOT_TTL_SEC = 120;

interface InMemorySlotState {
  counts: Map<string, number>;
  warned: boolean;
}

const inMemoryState: InMemorySlotState = {
  counts: new Map(),
  warned: false,
};

export interface BacktestSlotLease {
  ok: true;
  release: () => Promise<void>;
}

export interface BacktestSlotDenial {
  ok: false;
  reason: string;
  limit: number;
}

export async function acquireBacktestSlot(
  userId: string
): Promise<BacktestSlotLease | BacktestSlotDenial> {
  const limit = Math.max(1, MAX_CONCURRENT_BACKTESTS_PER_USER);
  const client = getRedis();
  const key = `backtest:concurrency:${userId}`;

  if (client) {
    try {
      const count = await client.incr(key);
      if (count === 1) {
        // Only set TTL on the first INCR so we do not keep bumping the
        // expiration on every subsequent slot acquisition and end up with a
        // key that never expires.
        await client.expire(key, REDIS_SLOT_TTL_SEC);
      }
      if (count > limit) {
        await client.decr(key);
        return {
          ok: false,
          reason: `Too many concurrent backtests (limit ${limit} per user). Wait for one to finish.`,
          limit,
        };
      }
      let released = false;
      return {
        ok: true,
        release: async () => {
          if (released) return;
          released = true;
          try {
            await client.decr(key);
          } catch (err) {
            console.warn("[backtestConcurrency] redis decr failed:", err);
          }
        },
      };
    } catch (err) {
      // Fail open to memory fallback so a transient Redis blip does not lock
      // everybody out of backtests.
      console.warn(
        "[backtestConcurrency] redis unavailable, falling back to memory:",
        err
      );
    }
  }

  if (!inMemoryState.warned && process.env.NODE_ENV === "production") {
    inMemoryState.warned = true;
    console.warn(
      "[backtestConcurrency] running without Redis in production — backtest concurrency cap is per-process only"
    );
  }

  const current = inMemoryState.counts.get(userId) ?? 0;
  if (current >= limit) {
    return {
      ok: false,
      reason: `Too many concurrent backtests (limit ${limit} per user). Wait for one to finish.`,
      limit,
    };
  }
  inMemoryState.counts.set(userId, current + 1);
  let released = false;
  return {
    ok: true,
    release: async () => {
      if (released) return;
      released = true;
      const now = inMemoryState.counts.get(userId) ?? 0;
      const next = Math.max(0, now - 1);
      if (next === 0) {
        inMemoryState.counts.delete(userId);
      } else {
        inMemoryState.counts.set(userId, next);
      }
    },
  };
}
