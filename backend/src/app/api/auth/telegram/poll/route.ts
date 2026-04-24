/**
 * GET /api/auth/telegram/poll?token=… — step 2 of the bot-first login flow.
 *
 * The browser polls this endpoint every ~1.5s after opening the deep link.
 * Once the webhook has flipped the `telegram_login_tokens` row to `claimed`,
 * this route mints a session cookie (login flow) or acknowledges the link
 * (already-authenticated flow) and consumes the token so it cannot be reused.
 *
 * Response shapes:
 *   { status: "pending" }   — waiting for the user to tap START.
 *   { status: "expired" }   — token TTL elapsed; browser should restart.
 *   { status: "used" }      — token was already consumed in a different tab.
 *   { status: "ok", linked: boolean, user: {…}, returnPath: string | null }
 *
 * Safe to call publicly: the token itself is the capability. 401 is returned
 * when the token is unknown so enumeration of valid tokens is meaningless.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  COOKIE_NAME,
  clearAllSessionCookies,
  createSession,
  sessionCookieWriteOptions,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import {
  consumeTelegramLoginToken,
  getTelegramLoginToken,
} from "@/lib/telegramBotAuth";
import { logTelegramOauth } from "@/lib/telegramOauthLog";

function noStore(res: NextResponse): NextResponse {
  res.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate, max-age=0"
  );
  return res;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return noStore(
      NextResponse.json({ error: "Missing token" }, { status: 400 })
    );
  }

  const row = await getTelegramLoginToken(token);
  if (!row) {
    return noStore(NextResponse.json({ error: "Unknown token" }, { status: 404 }));
  }

  const now = Date.now();
  if (row.status === "expired" || (row.status === "pending" && row.expiresAt.getTime() <= now)) {
    logTelegramOauth("bot_poll", { outcome: "expired" });
    return noStore(NextResponse.json({ status: "expired" }));
  }
  if (row.status === "used") {
    return noStore(NextResponse.json({ status: "used" }));
  }
  if (row.status === "pending") {
    return noStore(NextResponse.json({ status: "pending" }));
  }

  // status === "claimed" — mint the session cookie (or just acknowledge the
  // link) and atomically consume the token so a concurrent poll in another
  // tab can't replay it.
  const consumed = await consumeTelegramLoginToken(row.token);
  if (!consumed) {
    const fresh = await getTelegramLoginToken(row.token);
    if (fresh?.status === "used") {
      return noStore(NextResponse.json({ status: "used" }));
    }
    return noStore(NextResponse.json({ status: "pending" }));
  }

  if (!row.userId) {
    logTelegramOauth("bot_poll_claimed_without_user", { token: "[redacted]" });
    return noStore(
      NextResponse.json(
        { error: "Token claimed without user binding" },
        { status: 500 }
      )
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, row.userId));
  if (!user) {
    return noStore(
      NextResponse.json({ error: "User no longer exists" }, { status: 404 })
    );
  }

  const userPayload = {
    id: user.id,
    displayName: user.displayName,
    email: user.email ?? null,
    hasMudrexKey: Boolean(user.apiSecretEncrypted),
    telegramId: user.telegramId ?? null,
    telegramUsername: user.telegramUsername ?? null,
    telegramNotifyEnabled: user.telegramNotifyEnabled,
    telegramConnected: user.telegramConnected,
  };

  // Link-only mode: the browser was already logged in, so don't reset cookies.
  if (row.linkUserId && row.linkUserId === user.id) {
    logTelegramOauth("bot_poll", { outcome: "linked" });
    return noStore(
      NextResponse.json({
        status: "ok",
        linked: true,
        user: userPayload,
        returnPath: row.returnPath ?? null,
      })
    );
  }

  const sessionToken = await createSession(
    user.id,
    user.displayName,
    user.apiSecretEncrypted ?? null,
    user.email ?? null
  );

  logTelegramOauth("bot_poll", { outcome: "session" });
  const res = NextResponse.json({
    status: "ok",
    linked: false,
    user: userPayload,
    returnPath: row.returnPath ?? null,
  });
  clearAllSessionCookies(res);
  res.cookies.set(COOKIE_NAME, sessionToken, sessionCookieWriteOptions());
  return noStore(res);
}
