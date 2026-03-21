/** Simple fixed-window rate limit per strategy (in-memory). */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkCopyWebhookRateLimit(strategyId: string): boolean {
  const now = Date.now();
  const b = buckets.get(strategyId);
  if (!b || now >= b.resetAt) {
    buckets.set(strategyId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count++;
  return true;
}
