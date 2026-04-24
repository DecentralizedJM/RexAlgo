/**
 * Wipe all application data from Postgres (users, strategies, Telegram tokens,
 * webhooks, trade logs, etc.). Keeps Drizzle migration history intact.
 *
 * Intended for pre-prod / tester-only resets — destructive and irreversible.
 *
 * Usage (from `backend/`):
 *   REXALGO_CONFIRM_FLUSH_ALL_APP_DATA=yes npm run db:flush
 *
 * Or against Railway (shell or one-off):
 *   REXALGO_CONFIRM_FLUSH_ALL_APP_DATA=yes DATABASE_URL='postgres://…' npm run db:flush
 *
 * After truncate, runs `ensureDbReady()` so migrations stay applied and
 * `seedDatabase()` repopulates the catalogue `system` user + sample strategies
 * when the strategies table is empty.
 */
import fs from "fs";
import path from "path";
import { Pool } from "pg";

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

function shouldUseSsl(url: string): boolean {
  if (process.env.PGSSLMODE === "disable") return false;
  if (/sslmode=require/i.test(url)) return true;
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

function databaseHostHint(url: string): string {
  try {
    const u = new URL(url.replace(/^postgres:/i, "postgresql:"));
    return u.hostname || "(unknown host)";
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function isRailwayPrivateHostname(url: string): boolean {
  try {
    const u = new URL(url.replace(/^postgres:/i, "postgresql:"));
    return u.hostname.endsWith(".railway.internal");
  } catch {
    return false;
  }
}

const TRUNCATE_SQL = `
TRUNCATE TABLE
  "user_sessions",
  "telegram_login_tokens",
  "notifications_outbox",
  "tv_webhook_events",
  "tv_webhooks",
  "copy_mirror_attempts",
  "copy_signal_events",
  "copy_webhook_config",
  "trade_logs",
  "subscriptions",
  "strategies",
  "master_access_requests",
  "users"
RESTART IDENTITY CASCADE;
`.trim();

async function main() {
  if (process.env.REXALGO_CONFIRM_FLUSH_ALL_APP_DATA !== "yes") {
    console.error(
      "Refusing to run: set REXALGO_CONFIRM_FLUSH_ALL_APP_DATA=yes (exact string)."
    );
    process.exit(1);
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  if (isRailwayPrivateHostname(DATABASE_URL)) {
    console.error(
      "Refusing to connect: host ends with .railway.internal (private Railway DNS)."
    );
    console.error(
      "From your laptop that name will not resolve (ENOTFOUND). Use the public URL instead:"
    );
    console.error(
      "  Railway → Postgres service → Variables → DATABASE_PUBLIC_URL (or the TCP/public connect string)."
    );
    console.error(
      "Alternatives: run db:flush in a Railway shell on a service in the same project, or use `railway connect` to Postgres."
    );
    process.exit(1);
  }

  console.error("→ Target DB host:", databaseHostHint(DATABASE_URL));
  console.error("→ This permanently deletes all rows in application tables.");
  console.error("→ Drizzle migration table is NOT touched.\n");

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await pool.query("BEGIN");
    await pool.query(TRUNCATE_SQL);
    await pool.query("COMMIT");
    console.error("✓ Truncate committed.");
  } catch (e) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error("✗ Truncate failed, rolled back:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }

  // Re-seed catalogue (no-op if strategies already exist — they should not).
  const { ensureDbReady } = await import("../src/lib/db");
  const { seedDatabase } = await import("../src/lib/seed");
  await ensureDbReady();
  await seedDatabase();
  console.error("✓ ensureDbReady + seedDatabase finished.");
  console.error("\nTell testers to sign out in the browser (stale cookies) then sign in with Google again.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
