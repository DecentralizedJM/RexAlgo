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

function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}

export function telegramBotConfigured(): boolean {
  return Boolean(botToken());
}

export function telegramBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? "";
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
  if (typeof payload.hash !== "string" || !payload.hash) {
    return { ok: false, reason: "Missing hash" };
  }
  const hash = payload.hash;

  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === "hash" || v === undefined || v === null) continue;
    entries.push([k, String(v)]);
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
      hash,
    },
  };
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts?: { parseMode?: "MarkdownV2" | "HTML" }
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
