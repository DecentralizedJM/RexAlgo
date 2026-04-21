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
import { verifyTelegramLogin } from "@/lib/telegram";

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
  body: Record<string, unknown>
): Promise<RunTelegramAuthResult> {
  const verified = verifyTelegramLogin(body);
  if (!verified.ok) {
    return { ok: false, status: 400, message: verified.reason };
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
  url.searchParams.delete("return");

  const payload: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => {
    payload[k] = v;
  });

  if (Object.keys(payload).length === 0) {
    return NextResponse.json(
      { error: "Expected Telegram login query parameters" },
      { status: 400 }
    );
  }

  const origin = req.nextUrl.origin;
  const returnTo = sanitizeReturnPath(returnRaw, "/dashboard");
  const result = await runTelegramWidgetAuth(payload);

  if (!result.ok) {
    const errPath =
      returnTo === "/settings" || returnTo.startsWith("/settings?")
        ? "/settings"
        : "/auth";
    const errUrl = new URL(errPath, origin);
    errUrl.searchParams.set("telegram_error", result.message);
    return NextResponse.redirect(errUrl);
  }

  if (result.mode === "linked") {
    const okUrl = new URL(returnTo, origin);
    okUrl.searchParams.set("telegram_linked", "1");
    return NextResponse.redirect(okUrl);
  }

  const okUrl = new URL(returnTo, origin);
  const res = NextResponse.redirect(okUrl);
  clearAllSessionCookies(res);
  res.cookies.set(COOKIE_NAME, result.token, sessionCookieOptions());
  return res;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await runTelegramWidgetAuth(body);
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
