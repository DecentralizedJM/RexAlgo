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
import { installShutdownHandlers } from "./shutdown";
import { validateProductionConfig } from "@/lib/productionConfig";

validateProductionConfig();

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
  // Default 50 for a single busy replica; set `PGPOOL_MAX` lower per instance
  // when running multiple API replicas so the sum stays under Postgres
  // `max_connections` (minus superuser / migration headroom).
  max: Number.parseInt(process.env.PGPOOL_MAX ?? "50", 10),
  connectionTimeoutMillis: Number.parseInt(
    process.env.PG_CONNECTION_TIMEOUT_MS ?? "5000",
    10
  ),
  idleTimeoutMillis: Number.parseInt(process.env.PG_IDLE_TIMEOUT_MS ?? "30000", 10),
  statement_timeout: Number.parseInt(process.env.PG_STATEMENT_TIMEOUT_MS ?? "30000", 10),
  ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
});

/** Raw pool for `pg_advisory_*` (see `userFingerprintBackfill.ts`). */
export const dbPool = pool;

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

// Registers SIGTERM/SIGINT hooks that stop the notifications worker, wait
// for in-flight requests, and cleanly close the pool. No-op on repeat calls.
installShutdownHandlers(pool);

let bootPromise: Promise<void> | null = null;

const MIGRATION_ADVISORY_LOCK = 1_917_247_871; // stable 32-bit "rexalgo" lock id

async function migrateWithAdvisoryLock(migrationsFolder: string): Promise<void> {
  const client = await dbPool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK]);
    await migrate(db, { migrationsFolder });
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK]);
    } finally {
      client.release();
    }
  }
}

/**
 * Ensure schema is up to date + seed data exists. Safe to call many times.
 * Called implicitly on first DB use in dev; explicit in scripts/CLI.
 */
export function ensureDbReady(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      // Always run Drizzle migrate on first boot. It is idempotent (no-op when the
      // DB is already at head) and cheap when there is nothing to apply. We
      // previously skipped when `REXALGO_SKIP_MIGRATIONS=1` so operators could rely
      // only on Railway pre-deploy — but if that step fails or is missing, the API
      // would boot against an old schema and queries touching new columns would
      // fail (e.g. missing `user_secret_fingerprint`). Running migrate here
      // self-heals. You can still run `npm run migrate` in pre-deploy as a duplicate.
      const migrationsFolder = path.join(process.cwd(), "drizzle");
      await migrateWithAdvisoryLock(migrationsFolder);
      const { seedDatabase } = await import("./seed");
      await seedDatabase();
      const { maybeAutoBackfillUserFingerprints } = await import(
        "./userFingerprintBackfill"
      );
      await maybeAutoBackfillUserFingerprints();
      const { ensureNotificationsWorker } = await import("./notifications");
      ensureNotificationsWorker();
      const { ensureStrategySilenceDetectorWorker } = await import(
        "./strategySilenceDetector"
      );
      ensureStrategySilenceDetectorWorker();
    })().catch((err) => {
      bootPromise = null;
      throw err;
    });
  }
  return bootPromise;
}

/**
 * Boot (migrations + seed + notification worker) runs on first `ensureDbReady()`
 * (e.g. GET `/api/health` or any route that awaits it). We do not use
 * `src/instrumentation.ts`: Next.js 16 can evaluate that hook in the Edge runtime,
 * which cannot load this module (`pg` / Node `crypto`).
 *
 * Scripts that call `migrate()` themselves set `REXALGO_SKIP_DB_BOOT=1` and must
 * invoke `ensureDbReady()` / `migrate()` explicitly.
 */
