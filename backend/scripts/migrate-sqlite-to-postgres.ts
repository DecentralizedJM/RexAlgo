/**
 * One-shot data copier: SQLite (backend/rexalgo.db) -> Postgres (DATABASE_URL).
 *
 *   Usage (from backend/):
 *     npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 *   Optional:
 *     REXALGO_DB_PATH=/abs/path/to/rexalgo.db  (defaults to ./rexalgo.db)
 *     DATABASE_URL=postgres://...              (required)
 *
 * Safety:
 *   - Idempotent: uses ON CONFLICT DO NOTHING, so re-running is safe.
 *   - Non-destructive: does NOT drop or truncate Postgres tables.
 *   - Runs Drizzle migrations on the Postgres target first.
 *
 * This script is for the local dev cutover. Production starts on Postgres from day one.
 */
import path from "path";
import fs from "fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import Database from "better-sqlite3";
import * as schema from "../src/lib/schema";

process.env.REXALGO_SKIP_DB_BOOT = "1";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const SQLITE_PATH =
  process.env.REXALGO_DB_PATH || path.join(process.cwd(), "rexalgo.db");

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`SQLite file not found at ${SQLITE_PATH}. Nothing to migrate.`);
  process.exit(0);
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const pg = drizzle(pool, { schema });

  console.log("Running Drizzle migrations on Postgres...");
  await migrate(pg, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  console.log(`Opening SQLite at ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  type Row = Record<string, unknown>;
  const readAll = (table: string): Row[] =>
    sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[];

  const tableExists = (table: string): boolean => {
    const r = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
      )
      .get(table) as { name?: string } | undefined;
    return Boolean(r?.name);
  };

  const toDate = (v: unknown): Date | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return new Date(v * 1000);
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return new Date(n * 1000);
      const d = new Date(v);
      return Number.isNaN(d.valueOf()) ? null : d;
    }
    return null;
  };

  const toBool = (v: unknown): boolean => v === 1 || v === true || v === "1";

  async function copyUsers() {
    if (!tableExists("users")) return;
    const rows = readAll("users");
    console.log(`users: ${rows.length} rows`);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO users (id, email, auth_provider, display_name, api_secret_encrypted, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.email ?? null,
          r.auth_provider ?? "legacy",
          r.display_name,
          r.api_secret_encrypted ?? null,
          toDate(r.created_at) ?? new Date(),
        ]
      );
    }
  }

  async function copyStrategies() {
    if (!tableExists("strategies")) return;
    const rows = readAll("strategies");
    console.log(`strategies: ${rows.length} rows`);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO strategies (
           id, creator_id, creator_name, name, description, type, symbol, side,
           leverage, stoploss_pct, takeprofit_pct, risk_level, timeframe,
           backtest_spec_json, is_active, total_pnl, win_rate, total_trades,
           subscriber_count, created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.creator_id,
          r.creator_name,
          r.name,
          r.description,
          r.type,
          r.symbol,
          r.side,
          r.leverage ?? "1",
          r.stoploss_pct ?? null,
          r.takeprofit_pct ?? null,
          r.risk_level ?? "medium",
          r.timeframe ?? "1h",
          r.backtest_spec_json ?? null,
          toBool(r.is_active),
          r.total_pnl ?? 0,
          r.win_rate ?? 0,
          r.total_trades ?? 0,
          r.subscriber_count ?? 0,
          toDate(r.created_at) ?? new Date(),
        ]
      );
    }
  }

  async function copySubscriptions() {
    if (!tableExists("subscriptions")) return;
    const rows = readAll("subscriptions");
    console.log(`subscriptions: ${rows.length} rows`);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO subscriptions (id, user_id, strategy_id, margin_per_trade, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.user_id,
          r.strategy_id,
          r.margin_per_trade,
          toBool(r.is_active),
          toDate(r.created_at) ?? new Date(),
        ]
      );
    }
  }

  async function copyTradeLogs() {
    if (!tableExists("trade_logs")) return;
    const rows = readAll("trade_logs");
    console.log(`trade_logs: ${rows.length} rows`);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO trade_logs (
           id, user_id, strategy_id, order_id, symbol, side, quantity,
           entry_price, exit_price, pnl, status, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.user_id,
          r.strategy_id ?? null,
          r.order_id ?? null,
          r.symbol,
          r.side,
          r.quantity,
          r.entry_price ?? null,
          r.exit_price ?? null,
          r.pnl ?? null,
          r.status ?? "open",
          toDate(r.created_at) ?? new Date(),
        ]
      );
    }
  }

  async function copyWebhookConfig() {
    if (!tableExists("copy_webhook_config")) return;
    const rows = readAll("copy_webhook_config");
    console.log(`copy_webhook_config: ${rows.length} rows`);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO copy_webhook_config (strategy_id, secret_encrypted, enabled, created_at, rotated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (strategy_id) DO NOTHING`,
        [
          r.strategy_id,
          r.secret_encrypted,
          toBool(r.enabled),
          toDate(r.created_at) ?? new Date(),
          toDate(r.rotated_at),
        ]
      );
    }
  }

  async function copySignalEvents() {
    if (!tableExists("copy_signal_events")) return;
    const rows = readAll("copy_signal_events");
    console.log(`copy_signal_events: ${rows.length} rows`);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO copy_signal_events (id, strategy_id, idempotency_key, payload_json, received_at, client_ip)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.strategy_id,
          r.idempotency_key,
          r.payload_json,
          toDate(r.received_at) ?? new Date(),
          r.client_ip ?? null,
        ]
      );
    }
  }

  async function copyMirrorAttempts() {
    if (!tableExists("copy_mirror_attempts")) return;
    const rows = readAll("copy_mirror_attempts");
    console.log(`copy_mirror_attempts: ${rows.length} rows`);
    for (const r of rows) {
      await pool.query(
        `INSERT INTO copy_mirror_attempts (id, signal_id, user_id, status, detail, mudrex_order_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.signal_id,
          r.user_id,
          r.status,
          r.detail,
          r.mudrex_order_id ?? null,
          toDate(r.created_at) ?? new Date(),
        ]
      );
    }
  }

  await copyUsers();
  await copyStrategies();
  await copySubscriptions();
  await copyTradeLogs();
  await copyWebhookConfig();
  await copySignalEvents();
  await copyMirrorAttempts();

  sqlite.close();
  await pool.end();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
