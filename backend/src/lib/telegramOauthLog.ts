/**
 * Structured stdout logs for Telegram Login Widget OAuth.
 *
 * **Production:** logs emit only when running on **Railway** (`RAILWAY_ENVIRONMENT`
 * is set by the platform) so other hosts stay quiet. Override anytime with
 * `REXALGO_TELEGRAM_TRACE=1` (also adds PII-adjacent fields after verify).
 *
 * **Non-production:** always logs (local dev).
 *
 * Default payload: no secrets (no hash, no token). Includes param key names,
 * verify outcome, redirect target path.
 */
export function telegramOauthTraceEnabled(): boolean {
  return process.env.REXALGO_TELEGRAM_TRACE === "1";
}

export function telegramOauthLogsEnabled(): boolean {
  if (process.env.REXALGO_TELEGRAM_TRACE === "1") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT &&
      process.env.RAILWAY_ENVIRONMENT.length > 0
  );
}

export function logTelegramOauth(
  event: string,
  data: Record<string, unknown>
): void {
  if (!telegramOauthLogsEnabled()) return;
  console.info(
    "[rexalgo:telegram]",
    JSON.stringify({ ts: new Date().toISOString(), event, ...data })
  );
}
