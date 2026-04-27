import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { getMasterAccessStatus, isAdminUser } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { userHasSharedMudrexKey } from "@/lib/mudrexKeySharing";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const isAdmin = isAdminUser(session.user);
  const masterAccess = await getMasterAccessStatus(session.user);
  const mudrexKeySharedAcrossAccounts =
    session.apiSecret != null
      ? await userHasSharedMudrexKey(session.user.id)
      : false;

  // Telegram state is not in the JWT (we don't want to bump JWT size on every
  // login) — fetch it fresh so the navbar can reflect link/unlink changes.
  const [row] = await db
    .select({
      telegramId: users.telegramId,
      telegramUsername: users.telegramUsername,
      telegramNotifyEnabled: users.telegramNotifyEnabled,
      telegramConnected: users.telegramConnected,
    })
    .from(users)
    .where(eq(users.id, session.user.id));

  return NextResponse.json({
    user: {
      ...session.user,
      hasMudrexKey: session.apiSecret != null,
      mudrexKeySharedAcrossAccounts,
      isAdmin,
      masterAccess,
      telegramId: row?.telegramId ?? null,
      telegramUsername: row?.telegramUsername ?? null,
      telegramNotifyEnabled: row?.telegramNotifyEnabled ?? false,
      telegramConnected: row?.telegramConnected ?? false,
    },
    sessionExpiresAt:
      session.sessionExpiresAt?.toISOString() ?? null,
  });
}
