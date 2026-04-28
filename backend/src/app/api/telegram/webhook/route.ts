/**
 * POST /api/telegram/webhook — inbound updates from Telegram Bot API.
 *
 * Handles:
 *   - `/start rexalgo_<token>` → claim the login token, upsert user, flip
 *     `telegram_connected`, send the welcome message.
 *   - Bare `/start` with no payload → send a friendly nudge telling the user
 *     to open RexAlgo and tap "Log in with Telegram" to get a fresh link.
 *   - Any other update → 200 OK (no-op). We never polled; Telegram should not
 *     retry benign messages.
 *
 * Security:
 *   - Telegram signs the secret set via `setWebhook(secret_token=…)` in the
 *     `X-Telegram-Bot-Api-Secret-Token` header. We reject updates whose
 *     secret doesn't match, unless `REXALGO_TELEGRAM_ALLOW_UNSIGNED=1` (dev
 *     without `setWebhook`).
 *   - We always respond 200 on validated calls so Telegram doesn't retry
 *     (retries can cause the same `/start` to be handled twice in rapid
 *      succession).
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { ensureDbReady } from "@/lib/db";
import {
  answerTelegramCallbackQuery,
  parseStartDeepLinkPayload,
  sendTelegramMessage,
  telegramBotConfigured,
  telegramWebhookSecret,
} from "@/lib/telegram";
import { isAdminUser } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import {
  approveMasterAccessRequest,
  approveStrategyReview,
} from "@/lib/adminModeration";
import {
  attachUserToTelegramLoginToken,
  claimTelegramLoginToken,
  upsertUserFromTelegramStart,
  welcomeMessageFor,
} from "@/lib/telegramBotAuth";
import { logTelegramOauth } from "@/lib/telegramOauthLog";
import { enforceBodyLimit } from "@/lib/bodyLimit";

type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TelegramChat = {
  id?: number;
  type?: string;
};

type TelegramMessage = {
  message_id?: number;
  from?: TelegramUser;
  chat?: TelegramChat;
  date?: number;
  text?: string;
};

type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: {
    id?: string;
    data?: string;
    from?: TelegramUser;
    message?: TelegramMessage;
  };
};

function webhookAuthOk(req: NextRequest): boolean {
  const expected = telegramWebhookSecret();
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected) {
    return process.env.REXALGO_TELEGRAM_ALLOW_UNSIGNED === "1";
  }
  if (!got) return false;
  // Constant-time comparison across equally-sized buffers. Padding both to
  // `max(expected.length, got.length)` means an attacker cannot distinguish
  // "wrong length" from "wrong bytes" via response timing — crypto.timingSafeEqual
  // throws on mismatched-length inputs, so we equalise the buffers first.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  const len = Math.max(a.length, b.length);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  a.copy(padA);
  b.copy(padB);
  const equal = crypto.timingSafeEqual(padA, padB);
  return equal && a.length === b.length;
}

function displayNameFromTelegram(u: TelegramUser, telegramId: string): string {
  const composed = [u.first_name, u.last_name]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  if (composed) return composed;
  if (typeof u.username === "string" && u.username.trim()) return u.username.trim();
  return `tg_${telegramId}`;
}

/**
 * Handle a `/start [payload]` from a private chat. Exported-style helper kept
 * in the same file so route logic stays close to its parsing.
 */
async function handleStart(
  message: TelegramMessage,
  startPayload: string
): Promise<void> {
  const from = message.from;
  const chat = message.chat;
  if (!from?.id || !chat?.id || chat.type !== "private") {
    // Group/channel /start aren't part of the login UX; ignore.
    return;
  }

  const telegramId = String(from.id);
  const chatId = String(chat.id);
  const username =
    typeof from.username === "string" && from.username.trim()
      ? from.username.trim()
      : null;

  const loginToken = parseStartDeepLinkPayload(startPayload);
  if (!loginToken) {
    // Bare `/start` (or malformed payload) — don't mint sessions on our own;
    // guide the user back into the app so they start from a known token.
    await sendTelegramMessage(
      chatId,
      "👋 Hi! Open RexAlgo and tap <b>Log in with Telegram</b> to get your " +
        "personal one-tap link. Links are one-time and expire quickly to " +
        "keep your account safe."
    );
    logTelegramOauth("bot_start_bare", { telegramIdKnown: true });
    return;
  }

  const claimed = await claimTelegramLoginToken({
    token: loginToken,
    telegramId,
    telegramUsername: username,
  });

  if (!claimed) {
    logTelegramOauth("bot_start_token_invalid", { reason: "not_claimable" });
    await sendTelegramMessage(
      chatId,
      "⚠️ That login link has expired or was already used. Head back to " +
        "RexAlgo and tap <b>Log in with Telegram</b> to get a fresh one."
    );
    return;
  }

  const upserted = await upsertUserFromTelegramStart({
    linkUserId: claimed.linkUserId ?? null,
    telegramId,
    telegramUsername: username,
    telegramDisplayName: displayNameFromTelegram(from, telegramId),
    telegramChatId: chatId,
  });

  if (!upserted.ok) {
    logTelegramOauth("bot_start_upsert_failed", { reason: upserted.reason });
    await sendTelegramMessage(
      chatId,
      "⚠️ This Telegram account is already linked to a different RexAlgo " +
        "user. Sign in with that account and unlink Telegram first before " +
        "re-connecting."
    );
    return;
  }

  await attachUserToTelegramLoginToken(claimed.token, upserted.userId);

  logTelegramOauth("bot_start_claimed", { mode: upserted.mode });
  await sendTelegramMessage(chatId, welcomeMessageFor(upserted.mode));
}

async function resolveAdminFromTelegram(telegramId: string): Promise<{
  id: string;
  email: string | null;
} | null> {
  const [u] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  if (!u || !isAdminUser({ email: u.email })) return null;
  return u;
}

async function handleAdminCallback(update: TelegramUpdate): Promise<boolean> {
  const q = update.callback_query;
  const qid = q?.id;
  const data = q?.data ?? "";
  const fromId = q?.from?.id ? String(q.from.id) : null;
  const chatId =
    q?.message?.chat?.id != null ? String(q.message.chat.id) : null;

  if (!qid || !fromId || !data.startsWith("adm:")) return false;

  const admin = await resolveAdminFromTelegram(fromId);
  if (!admin) {
    await answerTelegramCallbackQuery(qid, {
      text: "Only admin Telegram accounts can do this.",
      showAlert: true,
    });
    return true;
  }

  const parts = data.split(":");
  if (parts.length !== 4) {
    await answerTelegramCallbackQuery(qid, {
      text: "Invalid admin action payload.",
      showAlert: true,
    });
    return true;
  }
  const [, domain, action, targetId] = parts;
  if (action !== "approve") {
    await answerTelegramCallbackQuery(qid, {
      text: "Unsupported action.",
      showAlert: true,
    });
    return true;
  }

  if (domain === "master") {
    const res = await approveMasterAccessRequest({
      requestId: targetId,
      reviewerUserId: admin.id,
      reviewerLabel: admin.email ?? `telegram:${fromId}`,
    });
    if (!res.ok) {
      await answerTelegramCallbackQuery(qid, {
        text: res.error,
        showAlert: true,
      });
      return true;
    }
    await answerTelegramCallbackQuery(qid, {
      text: "Master access approved.",
    });
    if (chatId) {
      await sendTelegramMessage(
        chatId,
        `✅ Master access approved for request <code>${targetId}</code>.`
      );
    }
    return true;
  }

  if (domain === "strategy") {
    const res = await approveStrategyReview({
      strategyId: targetId,
      reviewerUserId: admin.id,
    });
    if (!res.ok) {
      await answerTelegramCallbackQuery(qid, {
        text: res.error,
        showAlert: true,
      });
      return true;
    }
    await answerTelegramCallbackQuery(qid, {
      text: "Strategy approved.",
    });
    if (chatId) {
      await sendTelegramMessage(
        chatId,
        `✅ Strategy approved: <code>${targetId}</code>.`
      );
    }
    return true;
  }

  await answerTelegramCallbackQuery(qid, {
    text: "Unknown admin action.",
    showAlert: true,
  });
  return true;
}

export async function POST(req: NextRequest) {
  const tooLarge = enforceBodyLimit(req);
  if (tooLarge) return tooLarge;

  await ensureDbReady();
  if (!telegramBotConfigured()) {
    return NextResponse.json(
      { error: "Telegram bot is not configured" },
      { status: 503 }
    );
  }
  if (!webhookAuthOk(req)) {
    logTelegramOauth("bot_webhook_bad_secret", {});
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (await handleAdminCallback(update)) {
    return NextResponse.json({ ok: true });
  }

  const message = update.message ?? update.edited_message;
  if (!message || typeof message.text !== "string") {
    return NextResponse.json({ ok: true });
  }

  // Accept `/start`, `/start payload`, and `/start@BotName payload` — the
  // `@BotName` suffix is appended by Telegram when the bot is addressed from
  // a group chat, but we still want to be robust if it ever leaks into a
  // private chat payload.
  const text = message.text.trim();
  const startMatch = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(.*))?$/.exec(text);
  if (startMatch) {
    const payload = (startMatch[1] ?? "").trim();
    try {
      await handleStart(message, payload);
    } catch (e) {
      // Never surface errors to Telegram — we own retries via our outbox.
      logTelegramOauth("bot_start_error", {
        message: e instanceof Error ? e.message.slice(0, 180) : "unknown",
      });
    }
    return NextResponse.json({ ok: true });
  }

  // Other commands are no-ops for now — notifications are driven by the
  // outbox (src/lib/notifications.ts), not user chatter.
  return NextResponse.json({ ok: true });
}
