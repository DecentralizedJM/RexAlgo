/**
 * Postgres connection + Drizzle.
 *
 * - Reads `DATABASE_URL` (required).
 * - Uses a pooled `pg.Pool` shared across Next routes.
 * - Runs Drizzle migrations from `backend/drizzle/` on first access (idempotent).
 * - Seeds sample strategies once (no-op if any strategy rows exist).
 *
 * Horizontal scale note: the pool is per-process. Each Next API instance opens its own;
 * size accordingly via PG server max_connections.
 *
 * @see backend/src/lib/schema.ts | README.md#architecture
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "path";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Start Postgres (docker compose -f docker-compose.dev.yml up -d) " +
      "and add DATABASE_URL=postgres://rexalgo:rexalgo@127.0.0.1:5432/rexalgo to backend/.env.local"
  );
}

/**
 * Allow SSL in prod (Railway, Neon, Supabase all require it) without breaking local Postgres.
 * Callers can override via `PGSSLMODE=disable` if needed.
 */
function shouldUseSsl(url: string): boolean {
  if (process.env.PGSSLMODE === "disable") return false;
  if (/sslmode=require/i.test(url)) return true;
  if (process.env.NODE_ENV === "production") return true;
  return false;
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number.parseInt(process.env.PGPOOL_MAX ?? "10", 10),
  ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

let bootPromise: Promise<void> | null = null;

/**
 * Ensure schema is up to date + seed data exists. Safe to call many times.
 * Called implicitly on first DB use in dev; explicit in scripts/CLI.
 */
export function ensureDbReady(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      const migrationsFolder = path.join(process.cwd(), "drizzle");
      await migrate(db, { migrationsFolder });
      const { seedDatabase } = await import("./seed");
      await seedDatabase();
    })().catch((err) => {
      bootPromise = null;
      throw err;
    });
  }
  return bootPromise;
}

/**
 * Block module resolution until schema + seed are ready.
 * Next.js server modules support top-level await (Node ESM); this guarantees
 * every route that imports `db` sees a migrated database.
 *
 * Skipped for the one-shot SQLite -> Postgres script which calls `migrate()` itself
 * (it sets `REXALGO_SKIP_DB_BOOT=1`).
 */
if (process.env.REXALGO_SKIP_DB_BOOT !== "1") {
  await ensureDbReady();
  // Lazy-start the notifications worker so it drains notifications_outbox in
  // the background. No-ops when TELEGRAM_BOT_TOKEN is unset.
  const { ensureNotificationsWorker } = await import("./notifications");
  ensureNotificationsWorker();
}
