/**
 * Fixed-window rate limit for copy-trade / TradingView webhook ingress.
 *
 * Scope key is `strategyId` for copy-trade webhooks and `tv:<webhookId>` for
 * TradingView — one bucket per logical webhook so one noisy alert does not
 * starve another.
 *
 * Distributed path (preferred in production): Redis `INCR` + `PEXPIRE` on the
 * first increment of a new window. All API replicas share the same counter,
 * so the documented 120 req/min budget is enforced globally instead of being
 * multiplied by the replica count.
 *
 * Local fallback (dev, `REDIS_URL` unset, or Redis unreachable): in-process
 * `Map`. This is identical to the old behaviour and is correct for a single
 * API instance. We fail OPEN on Redis errors so a brief Redis outage does not
 * block live trade signals from reaching subscribers.
 *
 * @see docs/PROD.md §5.3 rate limiting
 */
import { getRedis } from "@/lib/redis";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

const local = new Map<string, { count: number; resetAt: number }>();

function checkLocal(key: string, now: number): boolean {
  const b = local.get(key);
  if (!b || now >= b.resetAt) {
    local.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count += 1;
  return true;
}

function redisKey(bucket: string, windowStart: number): string {
  return `rexalgo:webhookrl:${bucket}:${windowStart}`;
}

/**
 * Returns `true` when the request is within the window budget, `false` when it
 * should be rejected with 429. Falls back to an in-memory bucket when Redis is
 * not configured; fails OPEN on unexpected Redis errors.
 */
export async function checkCopyWebhookRateLimit(bucket: string): Promise<boolean> {
  const now = Date.now();
  const redis = getRedis();
  if (!redis) return checkLocal(bucket, now);

  const windowStart = now - (now % WINDOW_MS);
  const key = redisKey(bucket, windowStart);
  try {
    // Pipeline keeps us to a single RTT per check.
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
    return count <= MAX_PER_WINDOW;
  } catch (err) {
    console.warn("[copyWebhookRateLimit] redis check failed, allowing:", err);
    return true;
  }
}
