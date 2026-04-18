/**
 * Telegram login + account linking (Phase 6).
 *
 * POST /api/auth/telegram
 *   Body: Telegram Login Widget payload.
 *   Behaviour:
 *     - If an active session exists → link the Telegram id onto that user.
 *     - Else if a user already has this Telegram id  → sign them in.
 *     - Else → create a new user seeded from the Telegram profile and sign in.
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

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const verified = verifyTelegramLogin(body);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  const tg = verified.data;
  const tgId = String(tg.id);
  const tgUsername = tg.username ?? null;
  const tgDisplayName =
    [tg.first_name, tg.last_name].filter(Boolean).join(" ").trim() ||
    tg.username ||
    `tg_${tgId}`;

  const session = await getSession();

  // Case 1: Signed-in user wants to link Telegram to their existing account.
  if (session) {
    const conflict = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.telegramId, tgId), ne(users.id, session.user.id)));
    if (conflict.length > 0) {
      return NextResponse.json(
        { error: "This Telegram account is already linked to another user" },
        { status: 409 }
      );
    }
    await db
      .update(users)
      .set({
        telegramId: tgId,
        telegramUsername: tgUsername,
        telegramNotifyEnabled: true,
      })
      .where(eq(users.id, session.user.id));

    return NextResponse.json({
      success: true,
      linked: true,
      user: {
        id: session.user.id,
        displayName: session.user.displayName,
        email: session.user.email,
        hasMudrexKey: session.apiSecret != null,
        telegramId: tgId,
        telegramUsername: tgUsername,
      },
    });
  }

  // Case 2: No session — find an existing user by Telegram id, else create one.
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
    // Refresh username on every login — Telegram allows users to change it.
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

  const response = NextResponse.json({
    success: true,
    linked: false,
    user: {
      id: userId,
      displayName,
      email,
      hasMudrexKey: encryptedKey != null,
      telegramId: tgId,
      telegramUsername: tgUsername,
    },
  });
  clearAllSessionCookies(response);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: getSessionMaxAgeSeconds(),
    path: SESSION_COOKIE_PATH,
  });
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
