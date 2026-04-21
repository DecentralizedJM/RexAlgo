/**
 * Structured stdout logs for Telegram Login Widget OAuth (Railway / Vercel → API).
 *
 * Default: no secrets (no hash, no token). Includes param key names, verify
 * outcome, redirect target path.
 *
 * Set `REXALGO_TELEGRAM_TRACE=1` on the API service to also log Telegram user
 * id and `auth_date` after successful HMAC verification (PII-adjacent — use
 * only while debugging).
 */
export function telegramOauthTraceEnabled(): boolean {
  return process.env.REXALGO_TELEGRAM_TRACE === "1";
}

export function logTelegramOauth(
  event: string,
  data: Record<string, unknown>
): void {
  console.info(
    "[rexalgo:telegram]",
    JSON.stringify({ ts: new Date().toISOString(), event, ...data })
  );
}
