/**
 * Fills `users.user_secret_fingerprint` for legacy Mudrex-key users (audit #3).
 *
 * Runs automatically on first {@link ensureDbReady} after deploy so operators
 * do not need Railway shell / CLI. Uses `pg_try_advisory_lock` so only one
 * replica performs work when several processes cold-start together.
 *
 * Idempotent: if every row already has a fingerprint, exits immediately (cheap
 * `LIMIT 1` probe). The CLI script `npm run script:backfill-user-fingerprint`
 * delegates here for a single code path.
 */
import crypto from "crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { optionalEnv } from "@/lib/requireEnv";
import { db, dbPool } from "@/lib/db";
import { users } from "@/lib/schema";
import { decryptApiSecret } from "@/lib/auth";

/** Static pair — any int32 pair unique in our app namespace is fine. */
const ADVISORY_LOCK_K1 = 884_291_101;
const ADVISORY_LOCK_K2 = 300_291_402;

export type FingerprintBackfillResult = {
  updated: number;
  skipped: number;
};

/**
 * Decrypts each legacy `api_secret_encrypted`, writes HMAC fingerprint.
 * Caller must ensure `FINGERPRINT_SECRET` + `ENCRYPTION_KEY` are set when work exists.
 */
export async function backfillUserSecretFingerprints(): Promise<FingerprintBackfillResult> {
  const fingerprintSecret = optionalEnv("FINGERPRINT_SECRET");
  if (!fingerprintSecret?.trim()) {
    return { updated: 0, skipped: 0 };
  }

  const [pending] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(isNotNull(users.apiSecretEncrypted), isNull(users.userSecretFingerprint))
    )
    .limit(1);

  if (!pending) {
    return { updated: 0, skipped: 0 };
  }

  const lock = await dbPool.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::int, $2::int) AS "acquired"',
    [ADVISORY_LOCK_K1, ADVISORY_LOCK_K2]
  );
  if (!lock.rows[0]?.acquired) {
    console.log(
      "[user-fingerprint-backfill] skipped — another instance holds the advisory lock"
    );
    return { updated: 0, skipped: 0 };
  }

  try {
    return await runBackfillLocked(fingerprintSecret);
  } finally {
    await dbPool.query("SELECT pg_advisory_unlock($1::int, $2::int)", [
      ADVISORY_LOCK_K1,
      ADVISORY_LOCK_K2,
    ]);
  }
}

async function runBackfillLocked(
  fingerprintSecret: string
): Promise<FingerprintBackfillResult> {
  const targets = await db
    .select({
      id: users.id,
      apiSecretEncrypted: users.apiSecretEncrypted,
    })
    .from(users)
    .where(
      and(isNotNull(users.apiSecretEncrypted), isNull(users.userSecretFingerprint))
    );

  let updated = 0;
  let skipped = 0;
  for (const row of targets) {
    if (!row.apiSecretEncrypted) continue;
    // v1 and v2 envelopes always contain ':' (iv:tag:cipher or v2:salt:...).
    // Seed placeholders like `system-no-api` must never go through decrypt.
    if (!row.apiSecretEncrypted.includes(":")) {
      skipped += 1;
      console.warn(
        `[user-fingerprint-backfill] skipped user ${row.id}: not an encrypted envelope (placeholder?)`
      );
      continue;
    }
    try {
      const plain = decryptApiSecret(row.apiSecretEncrypted);
      const fingerprint = crypto
        .createHmac("sha256", fingerprintSecret)
        .update(plain, "utf8")
        .digest("hex");

      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.userSecretFingerprint, fingerprint))
        .limit(1);
      if (owner && owner.id !== row.id) {
        skipped += 1;
        console.warn(
          `[user-fingerprint-backfill] skipped user ${row.id}: fingerprint already ` +
            `owned by ${owner.id} (duplicate Mudrex key across accounts — resolve manually)`
        );
        continue;
      }

      await db
        .update(users)
        .set({ userSecretFingerprint: fingerprint })
        .where(eq(users.id, row.id));
      updated += 1;
    } catch (err) {
      skipped += 1;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : "";
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[user-fingerprint-backfill] skipped user ${row.id}: ${msg}` +
          (code ? ` [${code}]` : "")
      );
    }
  }

  return { updated, skipped };
}

let warnedMissingSecret = false;

/** Called from `ensureDbReady` — never throws; logs failures only. */
export async function maybeAutoBackfillUserFingerprints(): Promise<void> {
  try {
    if (!optionalEnv("FINGERPRINT_SECRET")?.trim()) {
      if (process.env.NODE_ENV === "production" && !warnedMissingSecret) {
        warnedMissingSecret = true;
        console.warn(
          "[user-fingerprint-backfill] FINGERPRINT_SECRET is unset — skipping auto backfill " +
            "(legacy Mudrex login fingerprint column will stay empty until you set it)"
        );
      }
      return;
    }

    const { updated, skipped } = await backfillUserSecretFingerprints();
    if (updated > 0 || skipped > 0) {
      console.log(
        `[user-fingerprint-backfill] done. updated=${updated} skipped=${skipped}`
      );
    }
  } catch (e) {
    console.error("[user-fingerprint-backfill] failed (non-fatal):", e);
  }
}
