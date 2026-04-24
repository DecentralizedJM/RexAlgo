/**
 * POST /api/auth/telegram/start — step 1 of the bot-first login flow.
 *
 * Creates a short-lived `telegram_login_tokens` row and hands the browser a
 * `t.me/<bot>?start=rexalgo_<token>` deep link. The browser opens that link
 * in a new tab (Telegram Web/Desktop/Mobile all handle it), the user taps
 * `START`, the bot webhook claims the token, and the frontend polls
 * `/api/auth/telegram/poll` for completion.
 *
 * Public endpoint: callable without a session (legacy Telegram-only login).
 * For **link** flows (Google user adding alerts), the client should send either
 * a normal session cookie **or** a short-lived `linkToken` from
 * `GET /api/auth/telegram/link-intent` — some browsers omit the cookie on POST
 * to `/api` while still sending it on GET, which previously stranded those users.
 *
 * Request body (optional):
 *   { returnPath?: string, linkToken?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession, verifyTelegramLinkIntentJwt } from "@/lib/auth";
import { db, ensureDbReady } from "@/lib/db";
import { users } from "@/lib/schema";
import {
  createTelegramLoginToken,
  TELEGRAM_LOGIN_TOKEN_TTL_MS,
} from "@/lib/telegramBotAuth";
import {
  telegramBotConfigured,
  telegramBotStartDeepLink,
  telegramBotUsername,
} from "@/lib/telegram";
import { logTelegramOauth } from "@/lib/telegramOauthLog";

const MAX_RETURN_PATH_LEN = 2048;

/** Reject open redirects via the `returnPath` query — only same-site paths allowed. */
function sanitiseReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/")) return null;
  if (decoded.startsWith("//")) return null;
  if (decoded.includes("://")) return null;
  return decoded.slice(0, MAX_RETURN_PATH_LEN);
}

export async function POST(req: NextRequest) {
  await ensureDbReady();
  if (!telegramBotConfigured() || !telegramBotUsername()) {
    return NextResponse.json(
      {
        error: "Telegram is not configured on this server",
        code: "TELEGRAM_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  let body: { returnPath?: unknown; linkToken?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as { returnPath?: unknown; linkToken?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const returnPath = sanitiseReturnPath(body.returnPath);
  const session = await getSession();

  let linkUserId: string | null = null;
  const linkTokenRaw =
    typeof body.linkToken === "string" ? body.linkToken.trim() : "";
  if (linkTokenRaw) {
    const fromJwt = await verifyTelegramLinkIntentJwt(linkTokenRaw);
    if (!fromJwt) {
      return NextResponse.json(
        { error: "Invalid or expired link token. Open Connect Telegram again." },
        { status: 400 }
      );
    }
    if (session && session.user.id !== fromJwt) {
      return NextResponse.json(
        { error: "Session does not match link token" },
        { status: 403 }
      );
    }
    linkUserId = fromJwt;
  } else if (session) {
    linkUserId = session.user.id;
  }

  if (linkUserId) {
    const [urow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, linkUserId));
    if (!urow) {
      return NextResponse.json(
        {
          error:
            "That account is not in our database anymore. Sign out and sign in with Google again, then connect Telegram.",
          code: "LINK_USER_MISSING",
        },
        { status: 401 }
      );
    }
  }

  const row = await createTelegramLoginToken({
    linkUserId,
    returnPath,
  });

  logTelegramOauth("bot_login_start", {
    method: "POST",
    mode: linkUserId ? "link" : "login",
    expiresInMs: TELEGRAM_LOGIN_TOKEN_TTL_MS,
    hasReturnPath: returnPath != null,
  });

  return NextResponse.json({
    ok: true,
    token: row.token,
    deepLink: telegramBotStartDeepLink(`rexalgo_${row.token}`),
    botUsername: telegramBotUsername(),
    expiresAt: row.expiresAt.toISOString(),
    expiresInMs: TELEGRAM_LOGIN_TOKEN_TTL_MS,
    mode: linkUserId ? "link" : "login",
  });
}
