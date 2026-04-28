/**
 * Server-side ack for the dashboard "shared Mudrex key" warning.
 *
 * Replaces the legacy `sessionStorage` flag on the dashboard. Persisting the
 * dismissal lets us keep it suppressed across logout/login on the same
 * machine, while still re-showing it automatically when the conditions that
 * justify the warning change:
 *
 *   - User rotates the Mudrex secret      → `userSecretFingerprint` changes
 *   - User signs in from a different IP   → `clientIpFromRequest` changes
 *
 * The read path lives in {@link effectiveSharedMudrexWarning} (called from
 * `/api/auth/me`).
 *
 * We refuse to record an ack when there is nothing to acknowledge — either
 * because the user has no Mudrex secret linked, or because their fingerprint
 * is not actually shared with another account. This avoids creating stale
 * ack rows that would silently suppress *future* legitimate warnings.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { clientIpFromRequest } from "@/lib/authRateLimit";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import {
  countLinkedUsersWithFingerprint,
} from "@/lib/mudrexKeySharing";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [u] = await db
    .select({
      fingerprint: users.userSecretFingerprint,
      apiSecretEncrypted: users.apiSecretEncrypted,
    })
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!u?.apiSecretEncrypted || !u.fingerprint) {
    return NextResponse.json(
      {
        error: "No Mudrex key linked.",
        code: "NO_MUDREX_KEY",
      },
      { status: 409 }
    );
  }

  const sharedCount = await countLinkedUsersWithFingerprint(u.fingerprint);
  if (sharedCount < 2) {
    return NextResponse.json(
      {
        error: "Mudrex key is not shared with another account.",
        code: "NOT_SHARED",
      },
      { status: 409 }
    );
  }

  const ip = clientIpFromRequest(req);

  await db
    .update(users)
    .set({
      sharedMudrexAckFingerprint: u.fingerprint,
      sharedMudrexAckIp: ip,
      sharedMudrexAckAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({ ok: true });
}
