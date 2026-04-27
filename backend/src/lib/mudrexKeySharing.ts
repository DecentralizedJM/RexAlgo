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
