/**
 * Telegram login + account linking (Phase 6).
 *
 * POST /api/auth/telegram
 *   Body: Telegram Login Widget payload (JSON callback flow).
 *
 * GET /api/auth/telegram?id=…&hash=…&return=/path
 *   Telegram Login Widget **redirect** flow (`data-auth-url`). Same auth logic
 *   as POST; strips `return` before verification. `return` must be a same-site
 *   path (see {@link sanitizeReturnPath}).
 *
 * Behaviour (POST + GET):
 *   - If an active session exists → link the Telegram id onto that user.
 *   - Else if a user already has this Telegram id  → sign them in.
 *   - Else → create a new user seeded from the Telegram profile and sign in.
 *
 * Response shape mirrors /api/auth/google for easy client reuse.
 */
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { and, eq, ne } from "drizzle-orm";
import {
  COOKIE_NAME,
  SESSION_COOKIE_PATH,
  clearAllSessionCookies,
  createSession,
  getSession,
  getSessionMaxAgeSeconds,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { browserPublicOriginFromRequest } from "@/lib/publicUrl";
import { verifyTelegramLogin } from "@/lib/telegram";
import {
  logTelegramOauth,
  telegramOauthTraceEnabled,
} from "@/lib/telegramOauthLog";

type TelegramJsonUser = {
  id: string;
  displayName: string;
  email: string | null;
  hasMudrexKey: boolean;
  telegramId: string;
  telegramUsername: string | null;
};

type RunTelegramAuthResult =
  | { ok: false; status: number; message: string }
  | { ok: true; mode: "linked"; user: TelegramJsonUser }
  | { ok: true; mode: "session"; token: string; user: TelegramJsonUser };

type TelegramOauthCtx = {
  method: "GET" | "POST";
  host?: string | null;
  forwardedHost?: string | null;
};

function telegramOauthCtx(
  req: NextRequest,
  method: "GET" | "POST"
): TelegramOauthCtx {
  return {
    method,
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
  };
}

function sanitizeReturnPath(raw: string | null, fallback: string): string {
  if (raw == null || raw === "") return fallback;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith("/")) return fallback;
  if (decoded.startsWith("//")) return fallback;
  if (decoded.includes("://")) return fallback;
  return decoded.slice(0, 2048);
}

async function runTelegramWidgetAuth(
  body: Record<string, unknown>,
  ctx: TelegramOauthCtx
): Promise<RunTelegramAuthResult> {
  const keys = Object.keys(body).sort();
  logTelegramOauth("oauth_in", {
    method: ctx.method,
    host: ctx.host ?? "",
    xForwardedHost: ctx.forwardedHost ?? "",
    keyCount: keys.length,
    keys: keys.join(","),
    hasHash: Boolean(typeof body.hash === "string" && body.hash.length > 0),
    hashLen:
      typeof body.hash === "string" ? Math.min(body.hash.length, 999) : 0,
    hasId: body.id != null && String(body.id).length > 0,
    hasAuthDate: body.auth_date != null && String(body.auth_date).length > 0,
  });

  const verified = verifyTelegramLogin(body);
  if (!verified.ok) {
    logTelegramOauth("oauth_verify_failed", {
      method: ctx.method,
      reason: verified.reason,
    });
    return { ok: false, status: 400, message: verified.reason };
  }

  if (telegramOauthTraceEnabled()) {
    logTelegramOauth("oauth_verify_ok_trace", {
      method: ctx.method,
      telegramUserId: verified.data.id,
      authDate: verified.data.auth_date,
    });
  } else {
    logTelegramOauth("oauth_verify_ok", { method: ctx.method });
  }

  const tg = verified.data;
  const tgId = String(tg.id);
  const tgUsername = tg.username ?? null;
  const tgDisplayName =
    [tg.first_name, tg.last_name].filter(Boolean).join(" ").trim() ||
    tg.username ||
    `tg_${tgId}`;

  const session = await getSession();

  if (session) {
    const conflict = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.telegramId, tgId), ne(users.id, session.user.id)));
    if (conflict.length > 0) {
      logTelegramOauth("oauth_conflict", { method: ctx.method, status: 409 });
      return {
        ok: false,
        status: 409,
        message: "This Telegram account is already linked to another user",
      };
    }
    await db
      .update(users)
      .set({
        telegramId: tgId,
        telegramUsername: tgUsername,
        telegramNotifyEnabled: true,
      })
      .where(eq(users.id, session.user.id));

    logTelegramOauth("oauth_done", {
      method: ctx.method,
      outcome: "linked",
    });
    return {
      ok: true,
      mode: "linked",
      user: {
        id: session.user.id,
        displayName: session.user.displayName,
        email: session.user.email,
        hasMudrexKey: session.apiSecret != null,
        telegramId: tgId,
        telegramUsername: tgUsername,
      },
    };
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, tgId));

  let userId: string;
  let displayName: string;
  let email: string | null;
  let encryptedKey: string | null;

  if (existing) {
    userId = existing.id;
    displayName = existing.displayName;
    email = existing.email ?? null;
    encryptedKey = existing.apiSecretEncrypted ?? null;
    if (existing.telegramUsername !== tgUsername) {
      await db
        .update(users)
        .set({ telegramUsername: tgUsername })
        .where(eq(users.id, existing.id));
    }
  } else {
    userId = uuidv4();
    displayName = tgDisplayName;
    email = null;
    encryptedKey = null;
    await db.insert(users).values({
      id: userId,
      email: null,
      authProvider: "telegram",
      displayName,
      apiSecretEncrypted: null,
      telegramId: tgId,
      telegramUsername: tgUsername,
      telegramNotifyEnabled: true,
    });
  }

  const token = await createSession(userId, displayName, encryptedKey, email);

  logTelegramOauth("oauth_done", {
    method: ctx.method,
    outcome: "session",
    existingTelegramUser: Boolean(existing),
  });
  return {
    ok: true,
    mode: "session",
    token,
    user: {
      id: userId,
      displayName,
      email,
      hasMudrexKey: encryptedKey != null,
      telegramId: tgId,
      telegramUsername: tgUsername,
    },
  };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: getSessionMaxAgeSeconds(),
    path: SESSION_COOKIE_PATH,
  };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  const returnRaw = url.searchParams.get("return");
  const paramCountBefore = url.searchParams.size;
  const redirectOrigin = browserPublicOriginFromRequest(req);
  logTelegramOauth("get_enter", {
    method: "GET",
    host: req.headers.get("host") ?? "",
    xForwardedHost: req.headers.get("x-forwarded-host") ?? "",
    xForwardedProto: req.headers.get("x-forwarded-proto") ?? "",
    nextOrigin: req.nextUrl.origin,
    redirectOrigin,
    paramCountBefore: paramCountBefore,
    hasReturnParam: returnRaw != null && returnRaw.length > 0,
    returnLen: returnRaw?.length ?? 0,
  });

  url.searchParams.delete("return");

  const payload: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => {
    payload[k] = v;
  });

  if (Object.keys(payload).length === 0) {
    logTelegramOauth("get_no_telegram_params", {
      host: req.headers.get("host") ?? "",
    });
    return NextResponse.json(
      { error: "Expected Telegram login query parameters" },
      { status: 400 }
    );
  }

  const returnTo = sanitizeReturnPath(returnRaw, "/dashboard");
  logTelegramOauth("get_return_sanitized", {
    returnPathLen: returnTo.length,
    returnStartsWithSettings: returnTo === "/settings" || returnTo.startsWith("/settings?") ? 1 : 0,
  });

  const result = await runTelegramWidgetAuth(payload, telegramOauthCtx(req, "GET"));

  if (!result.ok) {
    const errPath =
      returnTo === "/settings" || returnTo.startsWith("/settings?")
        ? "/settings"
        : "/auth";
    logTelegramOauth("get_redirect", {
      kind: "error",
      status: result.status,
      errPath,
      reasonSnippet: result.message.slice(0, 160),
    });
    const errUrl = new URL(errPath, redirectOrigin);
    errUrl.searchParams.set("telegram_error", result.message);
    const errRes = NextResponse.redirect(errUrl);
    errRes.headers.set("X-RexAlgo-Telegram-OAuth", "error");
    errRes.headers.set(
      "X-RexAlgo-Telegram-Reason",
      result.message.replace(/[^\x20-\x7E]/g, "?").slice(0, 180)
    );
    return errRes;
  }

  if (result.mode === "linked") {
    const okUrl = new URL(returnTo, redirectOrigin);
    okUrl.searchParams.set("telegram_linked", "1");
    logTelegramOauth("get_redirect", {
      kind: "ok",
      outcome: "linked",
      locationPath: okUrl.pathname,
    });
    const linkedRes = NextResponse.redirect(okUrl);
    linkedRes.headers.set("X-RexAlgo-Telegram-OAuth", "linked");
    return linkedRes;
  }

  const okUrl = new URL(returnTo, redirectOrigin);
  logTelegramOauth("get_redirect", {
    kind: "ok",
    outcome: "session",
    locationPath: okUrl.pathname,
  });
  const res = NextResponse.redirect(okUrl);
  res.headers.set("X-RexAlgo-Telegram-OAuth", "session");
  clearAllSessionCookies(res);
  res.cookies.set(COOKIE_NAME, result.token, sessionCookieOptions());
  return res;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    logTelegramOauth("post_invalid_json", { host: req.headers.get("host") ?? "" });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await runTelegramWidgetAuth(body, telegramOauthCtx(req, "POST"));
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  if (result.mode === "linked") {
    return NextResponse.json({
      success: true,
      linked: true,
      user: result.user,
    });
  }

  const response = NextResponse.json({
    success: true,
    linked: false,
    user: result.user,
  });
  clearAllSessionCookies(response);
  response.cookies.set(COOKIE_NAME, result.token, sessionCookieOptions());
  return response;
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await db
    .update(users)
    .set({
      telegramId: null,
      telegramUsername: null,
      telegramNotifyEnabled: false,
    })
    .where(eq(users.id, session.user.id));
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { notifyEnabled?: unknown };
  try {
    body = (await req.json()) as { notifyEnabled?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.notifyEnabled !== "boolean") {
    return NextResponse.json(
      { error: "notifyEnabled must be boolean" },
      { status: 400 }
    );
  }
  await db
    .update(users)
    .set({ telegramNotifyEnabled: body.notifyEnabled })
    .where(eq(users.id, session.user.id));
  return NextResponse.json({ ok: true, notifyEnabled: body.notifyEnabled });
}
