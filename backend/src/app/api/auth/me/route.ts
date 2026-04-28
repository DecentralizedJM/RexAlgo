import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { getMasterAccessStatus, isAdminUser } from "@/lib/adminAuth";
import { clientIpFromRequest } from "@/lib/authRateLimit";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { effectiveSharedMudrexWarning } from "@/lib/mudrexKeySharing";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const isAdmin = isAdminUser(session.user);
  const masterAccess = await getMasterAccessStatus(session.user);
  // The dashboard surfaces a yellow "shared key" badge based on this flag.
  // We check both the raw fingerprint share AND the persisted "It's ok" ack
  // (keyed on fingerprint + IP) so the warning stays dismissed across logins
  // until the user changes machines/networks or rotates the Mudrex secret.
  const mudrexKeySharedAcrossAccounts =
    session.apiSecret != null
      ? await effectiveSharedMudrexWarning(
          session.user.id,
          clientIpFromRequest(req)
        )
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
