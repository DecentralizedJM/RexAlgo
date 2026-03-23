import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.REXALGO_DB_PATH || path.join(process.cwd(), "rexalgo.db");

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      auth_provider TEXT NOT NULL DEFAULT 'legacy',
      display_name TEXT NOT NULL,
      api_secret_encrypted TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES users(id),
      creator_name TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('copy_trading', 'algo')),
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('LONG', 'SHORT', 'BOTH')),
      leverage TEXT NOT NULL DEFAULT '1',
      stoploss_pct REAL,
      takeprofit_pct REAL,
      risk_level TEXT NOT NULL DEFAULT 'medium' CHECK(risk_level IN ('low', 'medium', 'high')),
      timeframe TEXT DEFAULT '1h',
      backtest_spec_json TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      total_pnl REAL NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      subscriber_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      strategy_id TEXT NOT NULL REFERENCES strategies(id),
      margin_per_trade TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS trade_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      strategy_id TEXT REFERENCES strategies(id),
      order_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity TEXT NOT NULL,
      entry_price TEXT,
      exit_price TEXT,
      pnl TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'cancelled')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS copy_webhook_config (
      strategy_id TEXT PRIMARY KEY REFERENCES strategies(id) ON DELETE CASCADE,
      secret_encrypted TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      rotated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS copy_signal_events (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      received_at INTEGER NOT NULL DEFAULT (unixepoch()),
      client_ip TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS copy_signal_strategy_idem
      ON copy_signal_events(strategy_id, idempotency_key);

    CREATE TABLE IF NOT EXISTS copy_mirror_attempts (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL REFERENCES copy_signal_events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('ok', 'error')),
      detail TEXT NOT NULL,
      mudrex_order_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  migrateStrategiesBacktestSpec(sqlite);
  migrateUsersGoogleAuth(sqlite);
}

/** Add backtest_spec_json when upgrading existing SQLite DBs. */
function migrateStrategiesBacktestSpec(sqlite: InstanceType<typeof Database>) {
  const cols = sqlite
    .prepare(`PRAGMA table_info(strategies)`)
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "backtest_spec_json")) {
    sqlite.exec(
      `ALTER TABLE strategies ADD COLUMN backtest_spec_json TEXT;`
    );
  }
}

/** Add email + auth_provider columns and make api_secret_encrypted nullable. */
function migrateUsersGoogleAuth(sqlite: InstanceType<typeof Database>) {
  const cols = sqlite
    .prepare(`PRAGMA table_info(users)`)
    .all() as { name: string; notnull: number }[];

  if (cols.some((c) => c.name === "email")) return;

  const apiCol = cols.find((c) => c.name === "api_secret_encrypted");
  const needRecreate = apiCol && apiCol.notnull === 1;

  if (needRecreate) {
    sqlite.exec(`PRAGMA foreign_keys = OFF;`);
    sqlite.exec(`
      CREATE TABLE users_v2 (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        auth_provider TEXT NOT NULL DEFAULT 'legacy',
        display_name TEXT NOT NULL,
        api_secret_encrypted TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO users_v2 (id, email, auth_provider, display_name, api_secret_encrypted, created_at)
        SELECT id, NULL, 'legacy', display_name, api_secret_encrypted, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_v2 RENAME TO users;
    `);
    sqlite.exec(`PRAGMA foreign_keys = ON;`);
  } else {
    sqlite.exec(`ALTER TABLE users ADD COLUMN email TEXT UNIQUE;`);
    sqlite.exec(`ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'legacy';`);
  }
}

initializeDatabase();

async function runSeed() {
  const { seedDatabase } = await import("./seed");
  await seedDatabase();
}
runSeed().catch(console.error);
