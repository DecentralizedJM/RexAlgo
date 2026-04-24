/**
 * POST /api/auth/telegram/start — step 1 of the bot-first login flow.
 *
 * Creates a short-lived `telegram_login_tokens` row and hands the browser a
 * `t.me/<bot>?start=rexalgo_<token>` deep link. The browser opens that link
 * in a new tab (Telegram Web/Desktop/Mobile all handle it), the user taps
 * `START`, the bot webhook claims the token, and the frontend polls
 * `/api/auth/telegram/poll` for completion.
 *
 * Public endpoint: callable without a session (login flow). If a session is
 * present (Settings → "Connect Telegram"), the new Telegram identity is
 * linked to that user instead of creating a new one.
 *
 * Request body (optional):
 *   { returnPath?: string }   — sanitised same-site path the client should
 *                                navigate to after the session is minted.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
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
  if (!telegramBotConfigured() || !telegramBotUsername()) {
    return NextResponse.json(
      {
        error: "Telegram is not configured on this server",
        code: "TELEGRAM_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  let body: { returnPath?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw) body = JSON.parse(raw) as { returnPath?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const returnPath = sanitiseReturnPath(body.returnPath);
  const session = await getSession();
  const linkUserId = session?.user.id ?? null;

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
