/**
 * One-off backfill for `users.user_secret_fingerprint` (audit #3).
 *
 * Usage:
 *   FINGERPRINT_SECRET=<same-value-as-runtime> \
 *   ENCRYPTION_KEY=<same-value-as-runtime> \
 *   DATABASE_URL=<prod-db> \
 *   npm run script:backfill-user-fingerprint
 *
 * What it does:
 *   - Finds every `users` row with `api_secret_encrypted IS NOT NULL`
 *     AND `user_secret_fingerprint IS NULL`.
 *   - Decrypts the stored API secret (works on both v2 and legacy v1 envelopes).
 *   - Computes `HMAC-SHA256(FINGERPRINT_SECRET, apiSecret)` and writes it
 *     back into the column.
 *   - Skips rows that fail decryption (logs the id) so a partial run never
 *     kills the script.
 *
 * Idempotent: re-running does nothing because the first pass populated
 * every eligible row. Safe to run while the API is live — the update
 * touches a nullable column and every writer takes `UPDATE … SET … WHERE id = ?`
 * which does not conflict with login.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { users } from "../src/lib/schema";
import { decryptApiSecret } from "../src/lib/auth";

process.env.REXALGO_SKIP_DB_BOOT = "1";

/** Minimal `.env.local` loader (mirrors run-migrations.ts). */
function loadEnvLocalIfNeeded(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvLocalIfNeeded();

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") {
    console.error(`[backfill-user-fingerprint] ${name} is required`);
    process.exit(1);
  }
  return raw;
}

async function main() {
  const DATABASE_URL = requireEnv("DATABASE_URL");
  const FINGERPRINT_SECRET = requireEnv("FINGERPRINT_SECRET");
  requireEnv("ENCRYPTION_KEY"); // referenced inside decryptApiSecret

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl:
      process.env.PGSSLMODE === "disable" ||
      process.env.NODE_ENV !== "production"
        ? undefined
        : { rejectUnauthorized: false },
  });
  const db = drizzle(pool);

  const targets = await db
    .select({
      id: users.id,
      apiSecretEncrypted: users.apiSecretEncrypted,
    })
    .from(users)
    .where(
      and(isNotNull(users.apiSecretEncrypted), isNull(users.userSecretFingerprint))
    );

  console.log(`[backfill-user-fingerprint] ${targets.length} rows to process`);

  let ok = 0;
  let failed = 0;
  for (const row of targets) {
    if (!row.apiSecretEncrypted) continue;
    try {
      const plain = decryptApiSecret(row.apiSecretEncrypted);
      const fingerprint = crypto
        .createHmac("sha256", FINGERPRINT_SECRET)
        .update(plain, "utf8")
        .digest("hex");
      await db
        .update(users)
        .set({ userSecretFingerprint: fingerprint })
        .where(eq(users.id, row.id));
      ok += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `[backfill-user-fingerprint] skipped user ${row.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[backfill-user-fingerprint] done. updated=${ok} skipped=${failed}`
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
