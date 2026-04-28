import { and, count, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

/** Rows with this fingerprint and an active stored Mudrex secret. */
export async function countLinkedUsersWithFingerprint(
  fingerprint: string
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(
      and(
        eq(users.userSecretFingerprint, fingerprint),
        isNotNull(users.apiSecretEncrypted)
      )
    );
  return Number(row?.n ?? 0);
}

/**
 * True when this user's linked Mudrex secret matches at least one other RexAlgo
 * account that also has a linked key (same fingerprint).
 */
export async function userHasSharedMudrexKey(userId: string): Promise<boolean> {
  const [u] = await db
    .select({
      fingerprint: users.userSecretFingerprint,
      apiSecretEncrypted: users.apiSecretEncrypted,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!u?.apiSecretEncrypted || !u.fingerprint) return false;
  const n = await countLinkedUsersWithFingerprint(u.fingerprint);
  return n >= 2;
}

/**
 * Server-side replacement for the old `sessionStorage` dismiss flag.
 *
 * Returns whether the dashboard warning should be shown for this user *right
 * now*. The warning fires only when {@link userHasSharedMudrexKey} is true
 * AND we cannot match the persisted ack (`shared_mudrex_ack_*` columns)
 * against the request's current IP and the user's current fingerprint:
 *
 *   - Key rotation       → fingerprint changes → ack no longer matches → show
 *   - New machine/IP     → IP changes          → ack no longer matches → show
 *   - Same key + same IP → ack matches                                 → hide
 *
 * `currentIp` should come from {@link clientIpFromRequest}; pass `"unknown"`
 * (or any falsy value) and we will still compare strings — i.e. an ack
 * recorded as `"unknown"` will keep the warning hidden until either the IP
 * header reappears with a real value or the fingerprint changes. That is the
 * most conservative behaviour we can offer when we cannot identify the
 * client's network.
 */
export async function effectiveSharedMudrexWarning(
  userId: string,
  currentIp: string | null | undefined
): Promise<boolean> {
  const [u] = await db
    .select({
      fingerprint: users.userSecretFingerprint,
      apiSecretEncrypted: users.apiSecretEncrypted,
      ackFingerprint: users.sharedMudrexAckFingerprint,
      ackIp: users.sharedMudrexAckIp,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!u?.apiSecretEncrypted || !u.fingerprint) return false;

  const sharedCount = await countLinkedUsersWithFingerprint(u.fingerprint);
  if (sharedCount < 2) return false;

  const safeIp = (currentIp ?? "").trim() || "unknown";
  const ackMatchesFingerprint =
    u.ackFingerprint != null && u.ackFingerprint === u.fingerprint;
  const ackMatchesIp = u.ackIp != null && u.ackIp === safeIp;
  if (ackMatchesFingerprint && ackMatchesIp) return false;

  return true;
}
