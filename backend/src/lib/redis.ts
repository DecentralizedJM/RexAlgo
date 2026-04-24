/**
 * Shared Redis client for cross-instance state (rate limits, future session
 * cache, etc.). Optional: when `REDIS_URL` is unset, {@link getRedis} returns
 * `null` and callers fall back to in-memory behaviour suitable for single-node
 * local dev.
 *
 * Why ioredis: `pg` is already a Node dependency so we stay in the Node
 * runtime; ioredis has first-class TLS, cluster, and connection-pool behaviour
 * and is the default choice in most Node deployments. Upstash is only worth
 * pulling in when (a) Edge runtime needs Redis access or (b) you cannot run a
 * long-lived TCP client — neither is true for us today.
 *
 * @see docs/PROD.md §5.3 rate limiting, §7 scaling checklist
 */
import Redis, { type RedisOptions } from "ioredis";

let cached: Redis | null | undefined;

function isTlsUrl(url: string): boolean {
  return /^rediss:\/\//i.test(url);
}

function buildOptions(url: string): RedisOptions {
  const opts: RedisOptions = {
    // Never hang the request thread forever — fail fast and surface errors.
    connectTimeout: 5_000,
    // Retries use a short capped backoff so the limiter falls open quickly
    // under a Redis outage (we fail OPEN in the rate limiter — see below).
    maxRetriesPerRequest: 2,
    enableAutoPipelining: true,
    lazyConnect: false,
  };
  if (isTlsUrl(url)) {
    opts.tls = { rejectUnauthorized: false };
  }
  return opts;
}

/**
 * Returns a shared Redis client, or `null` when `REDIS_URL` is not configured.
 * Do not call `.quit()` on the return value — the process keeps a single
 * connection for its lifetime.
 */
export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    cached = null;
    return cached;
  }
  try {
    const client = new Redis(url, buildOptions(url));
    client.on("error", (err) => {
      // Log and keep going — callers must treat Redis as best-effort.
      console.warn("[redis] client error:", err.message);
    });
    cached = client;
    return cached;
  } catch (err) {
    console.warn("[redis] failed to initialise, falling back to in-memory:", err);
    cached = null;
    return cached;
  }
}

export function redisEnabled(): boolean {
  return getRedis() !== null;
}
