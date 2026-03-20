/**
 * Drizzle schema: users (encrypted Mudrex secret), strategies, subscriptions, trade logs.
 * @see backend/src/lib/db.ts | README.md#architecture
 */
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  apiSecretEncrypted: text("api_secret_encrypted").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const strategies = sqliteTable("strategies", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => users.id),
  creatorName: text("creator_name").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  type: text("type", { enum: ["copy_trading", "algo"] }).notNull(),
  symbol: text("symbol").notNull(),
  side: text("side", { enum: ["LONG", "SHORT", "BOTH"] }).notNull(),
  leverage: text("leverage").notNull().default("1"),
  stoplossPct: real("stoploss_pct"),
  takeprofitPct: real("takeprofit_pct"),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high"] })
    .notNull()
    .default("medium"),
  timeframe: text("timeframe").default("1h"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  totalPnl: real("total_pnl").notNull().default(0),
  winRate: real("win_rate").notNull().default(0),
  totalTrades: integer("total_trades").notNull().default(0),
  subscriberCount: integer("subscriber_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  strategyId: text("strategy_id")
    .notNull()
    .references(() => strategies.id),
  marginPerTrade: text("margin_per_trade").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const tradeLogs = sqliteTable("trade_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  strategyId: text("strategy_id").references(() => strategies.id),
  orderId: text("order_id"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: text("quantity").notNull(),
  entryPrice: text("entry_price"),
  exitPrice: text("exit_price"),
  pnl: text("pnl"),
  status: text("status", { enum: ["open", "closed", "cancelled"] })
    .notNull()
    .default("open"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
