/**
 * Bot-first Telegram login (fixes the "stuck on phone-confirm widget" bug).
 *
 * The Telegram Login Widget used a two-step handshake that required the user
 * to confirm each login in the Telegram app, **and** required the bot to have
 * been started at some earlier point to deliver the notification. When either
 * precondition was missing the widget hung on the "Please confirm access via
 * Telegram" screen (see the attached support screenshot).
 *
 * This module replaces that dance with a single deep link:
 *
 *   1. Browser calls `POST /api/auth/telegram/start` → we insert a
 *      `telegram_login_tokens` row with TTL 10 min and return
 *      `https://t.me/<bot>?start=rexalgo_<token>`.
 *   2. User taps the link, Telegram opens the bot, user taps `START`. Telegram
 *      delivers `/start rexalgo_<token>` to `/api/telegram/webhook`.
 *   3. Webhook looks up the token, upserts the user, captures `chat_id`, and
 *      marks the row `claimed`. First message to the user is sent
 *      immediately so they see value instantly.
 *   4. Browser's `GET /api/auth/telegram/poll?token=…` sees `claimed`, mints a
 *      session cookie, and consumes the token.
 *
 * The same flow handles both sign-up / sign-in **and** the "Connect Telegram"
 * linking action from Settings — the difference is whether the start request
 * carried an authenticated session (`linkUserId`).
 */
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { telegramLoginTokens, users } from "@/lib/schema";

/**
 * Token TTL. Short enough that a lost phone / abandoned tab doesn't leave a
 * valid handshake lying around; long enough that users can switch apps,
 * install Telegram, etc. 10 min matches our other short-lived flows.
 */
export const TELEGRAM_LOGIN_TOKEN_TTL_MS = 10 * 60 * 1000;

export type TelegramLoginTokenRow = typeof telegramLoginTokens.$inferSelect;

/**
 * Generate a URL-safe 24-char token (≈144 bits of entropy). Fits well within
 * Telegram's 64-char limit on the `start` deep-link param, and stays below
 * the documented A-Za-z0-9_- charset.
 */
function generateRandomToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export async function createTelegramLoginToken(opts: {
  linkUserId?: string | null;
  returnPath?: string | null;
}): Promise<TelegramLoginTokenRow> {
  const token = generateRandomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TELEGRAM_LOGIN_TOKEN_TTL_MS);

  const [row] = await db
    .insert(telegramLoginTokens)
    .values({
      token,
      status: "pending",
      linkUserId: opts.linkUserId ?? null,
      returnPath: opts.returnPath ?? null,
      createdAt: now,
      expiresAt,
    })
    .returning();

  return row;
}

export async function getTelegramLoginToken(
  token: string
): Promise<TelegramLoginTokenRow | null> {
  const [row] = await db
    .select()
    .from(telegramLoginTokens)
    .where(eq(telegramLoginTokens.token, token));
  return row ?? null;
}

/**
 * Webhook-side: atomically flip `pending → claimed` so at most one bot update
 * wins when Telegram redelivers an inbound `/start`. We record the Telegram
 * identity but defer `userId` binding to {@link attachUserToTelegramLoginToken}
 * because a sign-up may still need to create the user row.
 *
 * Returns the updated row on success; `null` when the token is unknown,
 * expired, or already claimed/consumed (caller should silently drop).
 */
export async function claimTelegramLoginToken(opts: {
  token: string;
  telegramId: string;
  telegramUsername: string | null;
}): Promise<TelegramLoginTokenRow | null> {
  const now = new Date();
  const [row] = await db
    .update(telegramLoginTokens)
    .set({
      status: "claimed",
      telegramId: opts.telegramId,
      telegramUsername: opts.telegramUsername,
      claimedAt: now,
    })
    .where(
      and(
        eq(telegramLoginTokens.token, opts.token),
        eq(telegramLoginTokens.status, "pending"),
        gt(telegramLoginTokens.expiresAt, now)
      )
    )
    .returning();
  return row ?? null;
}

/** Set `userId` on a claimed token after the user upsert has resolved. */
export async function attachUserToTelegramLoginToken(
  token: string,
  userId: string
): Promise<void> {
  await db
    .update(telegramLoginTokens)
    .set({ userId })
    .where(eq(telegramLoginTokens.token, token));
}

/** Poll-side: flip the row to `used` so a stolen token can't be replayed. */
export async function consumeTelegramLoginToken(
  token: string
): Promise<boolean> {
  const [row] = await db
    .update(telegramLoginTokens)
    .set({ status: "used" })
    .where(
      and(
        eq(telegramLoginTokens.token, token),
        eq(telegramLoginTokens.status, "claimed")
      )
    )
    .returning({ token: telegramLoginTokens.token });
  return Boolean(row);
}

/** Garbage-collect tokens that expired without being claimed. */
export async function expireStaleTelegramLoginTokens(): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(telegramLoginTokens)
    .set({ status: "expired" })
    .where(
      and(
        eq(telegramLoginTokens.status, "pending"),
        lt(telegramLoginTokens.expiresAt, now)
      )
    )
    .returning({ token: telegramLoginTokens.token });
  return rows.length;
}

/**
 * Upsert a user bound to the given Telegram identity. Priority:
 *
 *   1. If `linkUserId` is provided (Settings → Connect), attach the Telegram
 *      identity to that user — but reject if some other user already owns the
 *      same `telegramId`.
 *   2. Otherwise, if a user already exists for the Telegram id, return it and
 *      refresh the chat metadata.
 *   3. Otherwise, create a new `telegram`-provider user.
 *
 * Returns `{ user, mode }` where `mode` is `"linked" | "login" | "signup"` so
 * callers can pick a different welcome message / analytics event.
 */
export async function upsertUserFromTelegramStart(opts: {
  linkUserId: string | null;
  telegramId: string;
  telegramUsername: string | null;
  telegramDisplayName: string;
  telegramChatId: string;
}): Promise<
  | {
      ok: true;
      userId: string;
      displayName: string;
      email: string | null;
      apiSecretEncrypted: string | null;
      mode: "linked" | "login" | "signup";
    }
  | { ok: false; reason: "telegram_taken" }
> {
  if (opts.linkUserId) {
    const [conflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramId, opts.telegramId));
    if (conflict && conflict.id !== opts.linkUserId) {
      return { ok: false, reason: "telegram_taken" };
    }

    const [updated] = await db
      .update(users)
      .set({
        telegramId: opts.telegramId,
        telegramUsername: opts.telegramUsername,
        telegramChatId: opts.telegramChatId,
        telegramConnected: true,
        telegramNotifyEnabled: true,
      })
      .where(eq(users.id, opts.linkUserId))
      .returning({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        apiSecretEncrypted: users.apiSecretEncrypted,
      });

    if (!updated) {
      // Session user was deleted between start and webhook — fall through to
      // regular login/signup so the user isn't left stranded.
    } else {
      return {
        ok: true,
        userId: updated.id,
        displayName: updated.displayName,
        email: updated.email ?? null,
        apiSecretEncrypted: updated.apiSecretEncrypted ?? null,
        mode: "linked",
      };
    }
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, opts.telegramId));
  if (existing) {
    await db
      .update(users)
      .set({
        telegramUsername: opts.telegramUsername,
        telegramChatId: opts.telegramChatId,
        telegramConnected: true,
      })
      .where(eq(users.id, existing.id));
    return {
      ok: true,
      userId: existing.id,
      displayName: existing.displayName,
      email: existing.email ?? null,
      apiSecretEncrypted: existing.apiSecretEncrypted ?? null,
      mode: "login",
    };
  }

  const userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    email: null,
    authProvider: "telegram",
    displayName: opts.telegramDisplayName,
    apiSecretEncrypted: null,
    telegramId: opts.telegramId,
    telegramUsername: opts.telegramUsername,
    telegramChatId: opts.telegramChatId,
    telegramConnected: true,
    telegramNotifyEnabled: true,
  });
  return {
    ok: true,
    userId,
    displayName: opts.telegramDisplayName,
    email: null,
    apiSecretEncrypted: null,
    mode: "signup",
  };
}

/**
 * Friendly first-message copy. Sent immediately after `/start` succeeds so
 * the user gets visible value before they even leave Telegram — a key lever
 * for activation rate (users_started_bot / users_clicked_connect).
 */
export function welcomeMessageFor(mode: "linked" | "login" | "signup"): string {
  const body =
    mode === "linked"
      ? "You've connected Telegram to your RexAlgo account."
      : mode === "login"
        ? "Welcome back! You're signed in to RexAlgo on this device."
        : "Welcome to RexAlgo.";
  return (
    "⚡ <b>Alerts activated.</b>\n" +
    `${body}\n\n` +
    "You'll now get real-time updates for your trades — no more missed " +
    "entries, no more surprise liquidations."
  );
}
