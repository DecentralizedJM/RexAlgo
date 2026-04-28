/**
 * Telegram integration helpers (Phase 6).
 *
 * - `verifyTelegramLogin` validates a payload from the Telegram Login Widget per
 *   https://core.telegram.org/widgets/login#checking-authorization. The hash is
 *   HMAC-SHA256 over the alphabetically-sorted `key=value\n...` string of all
 *   non-`hash` fields, keyed by SHA-256 of the bot token.
 * - `sendTelegramMessage` calls the Bot API's `sendMessage`. Missing bot token
 *   returns `{ ok: false, reason: "not_configured" }` so callers can treat it
 *   as a benign skip in local dev.
 *
 * No exceptions are thrown for network / API errors — we return structured
 * results so the outbox worker can mark attempts rather than crash.
 */
import crypto from "crypto";

export type TelegramLoginPayload = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

const MAX_AUTH_AGE_SEC = 60 * 60 * 24; // 24h

/** Only these keys participate in the widget HMAC (core.telegram.org/widgets/login). */
const TELEGRAM_LOGIN_SIGNED_KEYS = new Set([
  "auth_date",
  "first_name",
  "id",
  "last_name",
  "photo_url",
  "username",
]);

function botToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

export function telegramBotConfigured(): boolean {
  return Boolean(botToken());
}

export function telegramBotUsername(): string {
  return (process.env.TELEGRAM_BOT_USERNAME ?? "").trim();
}

/**
 * Shared secret for the inbound `/telegram/webhook`. Telegram includes it as
 * `X-Telegram-Bot-Api-Secret-Token` on every update when `setWebhook` was
 * called with `secret_token`. Empty string means the webhook runs unsecured —
 * we refuse updates in that case unless `REXALGO_TELEGRAM_ALLOW_UNSIGNED=1`.
 */
export function telegramWebhookSecret(): string {
  return (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
}

/** Public base URL (origin only) used when registering the webhook with Telegram. */
export function telegramBotStartDeepLink(token: string): string {
  const username = telegramBotUsername();
  if (!username) {
    throw new Error("TELEGRAM_BOT_USERNAME is not configured");
  }
  return `https://t.me/${username}?start=${encodeURIComponent(token)}`;
}

/** Parse `rexalgo_<token>` out of a `/start` payload, returning the token only. */
export function parseStartDeepLinkPayload(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const prefix = "rexalgo_";
  if (!trimmed.startsWith(prefix)) return null;
  const body = trimmed.slice(prefix.length);
  // Telegram allows A-Za-z0-9_- up to 64 chars in the start param.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(body)) return null;
  return body;
}

export function verifyTelegramLogin(
  payload: Record<string, unknown>
):
  | { ok: true; data: TelegramLoginPayload }
  | { ok: false; reason: string } {
  const token = botToken();
  if (!token) {
    return { ok: false, reason: "TELEGRAM_BOT_TOKEN not configured" };
  }
  const hashRaw = typeof payload.hash === "string" ? payload.hash.trim() : "";
  if (!hashRaw) {
    return { ok: false, reason: "Missing hash" };
  }
  const hash = hashRaw.toLowerCase();

  // Telegram omits optional fields when empty. Stray query keys (analytics,
  // proxies) must not enter the check string — only fields Telegram signs.
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === "hash" || !TELEGRAM_LOGIN_SIGNED_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    const sv = String(v);
    if (sv === "") continue;
    entries.push([k, sv]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto.createHash("sha256").update(token).digest();
  const expected = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0 || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "Invalid Telegram login hash" };
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: "Invalid auth_date" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > MAX_AUTH_AGE_SEC) {
    return { ok: false, reason: "Login data is too old (auth_date expired)" };
  }

  const id = Number(payload.id);
  if (!Number.isFinite(id)) {
    return { ok: false, reason: "Invalid Telegram user id" };
  }

  return {
    ok: true,
    data: {
      id,
      first_name:
        typeof payload.first_name === "string" ? payload.first_name : undefined,
      last_name:
        typeof payload.last_name === "string" ? payload.last_name : undefined,
      username:
        typeof payload.username === "string" ? payload.username : undefined,
      photo_url:
        typeof payload.photo_url === "string" ? payload.photo_url : undefined,
      auth_date: authDate,
      hash: hashRaw,
    },
  };
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts?: {
    parseMode?: "MarkdownV2" | "HTML";
    replyMarkup?: Record<string, unknown>;
  }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = botToken();
  if (!token) return { ok: false, reason: "not_configured" };

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
          parse_mode: opts?.parseMode ?? "HTML",
          ...(opts?.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `Telegram HTTP ${res.status}: ${body.slice(0, 180)}`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (data.ok === false) {
      return { ok: false, reason: data.description ?? "Telegram returned ok=false" };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Telegram network error",
    };
  }
}

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  opts?: { text?: string; showAlert?: boolean }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = botToken();
  if (!token) return { ok: false, reason: "not_configured" };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/answerCallbackQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: opts?.text,
          show_alert: opts?.showAlert ?? false,
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `Telegram HTTP ${res.status}: ${body.slice(0, 180)}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Telegram network error",
    };
  }
}
