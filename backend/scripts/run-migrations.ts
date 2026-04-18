/**
 * CLI migrator: apply all Drizzle migrations to `DATABASE_URL`.
 *
 *   DATABASE_URL=... npm run db:migrate
 *   npm run db:migrate   # reads `backend/.env.local` when DATABASE_URL is unset
 *
 * Used during deploy (Railway release step) and for manual local resets.
 */
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

process.env.REXALGO_SKIP_DB_BOOT = "1";

/** Minimal `.env.local` loader (no dotenv dependency). */
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

loadEnvLocalIfNeeded();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl:
      process.env.PGSSLMODE === "disable" || process.env.NODE_ENV !== "production"
        ? undefined
        : { rejectUnauthorized: false },
  });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
