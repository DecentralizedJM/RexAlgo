/**
 * CLI wrapper for {@link backfillUserSecretFingerprints} (audit #3).
 *
 * Prefer letting the API run this automatically on first boot — see
 * `lib/userFingerprintBackfill.ts` + `ensureDbReady`. This script remains for
 * manual runs / local debugging.
 *
 *   DATABASE_URL=... ENCRYPTION_KEY=... FINGERPRINT_SECRET=... \
 *     npm run script:backfill-user-fingerprint
 */
import fs from "fs";
import path from "path";

/** Minimal `.env.local` loader (mirrors run-migrations.ts). */
function loadEnvLocalIfNeeded(): void {
  if (process.env.DATABASE_URL) return;
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
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

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") {
    console.error(`[backfill-user-fingerprint] ${name} is required`);
    process.exit(1);
  }
  return raw;
}

async function main() {
  process.env.REXALGO_SKIP_DB_BOOT = "1";
  loadEnvLocalIfNeeded();
  requireEnv("DATABASE_URL");
  requireEnv("FINGERPRINT_SECRET");
  requireEnv("ENCRYPTION_KEY");

  const { backfillUserSecretFingerprints } = await import(
    "../src/lib/userFingerprintBackfill"
  );
  const { updated, skipped } = await backfillUserSecretFingerprints();
  console.log(
    `[backfill-user-fingerprint] done. updated=${updated} skipped=${skipped}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
