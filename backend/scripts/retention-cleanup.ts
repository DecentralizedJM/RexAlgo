/**
 * Production retention job for high-volume append-only tables.
 *
 * Run from a scheduler (daily is enough for the current schema):
 *   DATABASE_URL=... npm run db:retention
 */
import fs from "fs";
import path from "path";
import { Pool } from "pg";

process.env.REXALGO_SKIP_DB_BOOT = "1";

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

function days(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function deleteOlderThan(
  pool: Pool,
  table: string,
  column: string,
  keepDays: number
): Promise<number> {
  const res = await pool.query(
    `delete from "${table}" where "${column}" < now() - ($1::text || ' days')::interval`,
    [keepDays]
  );
  return res.rowCount ?? 0;
}

async function main() {
  loadEnvLocalIfNeeded();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl:
      process.env.PGSSLMODE === "disable" || process.env.NODE_ENV !== "production"
        ? undefined
        : { rejectUnauthorized: false },
  });

  try {
    const results = {
      copySignalEvents: await deleteOlderThan(
        pool,
        "copy_signal_events",
        "received_at",
        days("REXALGO_RETENTION_COPY_EVENTS_DAYS", 90)
      ),
      tvWebhookEvents: await deleteOlderThan(
        pool,
        "tv_webhook_events",
        "received_at",
        days("REXALGO_RETENTION_TV_EVENTS_DAYS", 90)
      ),
      copyMirrorAttempts: await deleteOlderThan(
        pool,
        "copy_mirror_attempts",
        "created_at",
        days("REXALGO_RETENTION_MIRROR_ATTEMPTS_DAYS", 90)
      ),
      notificationsOutbox: await deleteOlderThan(
        pool,
        "notifications_outbox",
        "created_at",
        days("REXALGO_RETENTION_NOTIFICATIONS_DAYS", 90)
      ),
      adminAuditLog: await deleteOlderThan(
        pool,
        "admin_audit_log",
        "created_at",
        days("REXALGO_RETENTION_ADMIN_AUDIT_DAYS", 730)
      ),
    };
    console.log(JSON.stringify({ ok: true, deleted: results }));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
