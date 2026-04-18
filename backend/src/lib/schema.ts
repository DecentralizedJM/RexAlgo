/**
 * Drizzle schema (Postgres): users, strategies, subscriptions, trade logs, copy webhook config/events.
 * Timestamps are `timestamp with time zone` (UTC).
 *
 * Later phases extend this file with additional tables:
 *   Phase 2: masterAccessRequests
 *   Phase 5: tvWebhooks, tvWebhookEvents
 *   Phase 6: notificationsOutbox + telegram fields on users
 *
 * @see backend/src/lib/db.ts | README.md#architecture
 */
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  authProvider: text("auth_provider").notNull().default("legacy"),
  displayName: text("display_name").notNull(),
  apiSecretEncrypted: text("api_secret_encrypted"),
  /** Telegram numeric user id (as string to dodge 53-bit JS number limits). */
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  /** When true, we enqueue Telegram DMs for notable events (see notificationsOutbox). */
  telegramNotifyEnabled: boolean("telegram_notify_enabled")
    .notNull()
    .default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const strategies = pgTable("strategies", {
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
  stoplossPct: doublePrecision("stoploss_pct"),
  takeprofitPct: doublePrecision("takeprofit_pct"),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high"] })
    .notNull()
    .default("medium"),
  timeframe: text("timeframe").default("1h"),
  /** JSON: { engine, params } — drives strategy-bound simulation (see lib/backtest/spec.ts). */
  backtestSpecJson: text("backtest_spec_json"),
  isActive: boolean("is_active").notNull().default(true),
  totalPnl: doublePrecision("total_pnl").notNull().default(0),
  winRate: doublePrecision("win_rate").notNull().default(0),
  totalTrades: integer("total_trades").notNull().default(0),
  subscriberCount: integer("subscriber_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  strategyId: text("strategy_id")
    .notNull()
    .references(() => strategies.id, { onDelete: "cascade" }),
  marginPerTrade: text("margin_per_trade").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const tradeLogs = pgTable("trade_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  strategyId: text("strategy_id").references(() => strategies.id, {
    onDelete: "set null",
  }),
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
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** Webhook signing secret (encrypted) for master’s external bot. */
export const copyWebhookConfig = pgTable("copy_webhook_config", {
  strategyId: text("strategy_id")
    .primaryKey()
    .references(() => strategies.id, { onDelete: "cascade" }),
  secretEncrypted: text("secret_encrypted").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  /** Optional human-friendly webhook name shown in studio UI (defaults to strategy name on create). */
  name: text("name"),
  /** Timestamp of the most recently accepted delivery (updated from webhook ingress). */
  lastDeliveryAt: timestamp("last_delivery_at", {
    withTimezone: true,
    mode: "date",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true, mode: "date" }),
});

export const copySignalEvents = pgTable(
  "copy_signal_events",
  {
    id: text("id").primaryKey(),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    clientIp: text("client_ip"),
  },
  (t) => [uniqueIndex("copy_signal_strategy_idem").on(t.strategyId, t.idempotencyKey)]
);

export const copyMirrorAttempts = pgTable("copy_mirror_attempts", {
  id: text("id").primaryKey(),
  signalId: text("signal_id")
    .notNull()
    .references(() => copySignalEvents.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  detail: text("detail").notNull(),
  mudrexOrderId: text("mudrex_order_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * Master Studio access requests (Phase 2).
 * A user may hold at most one `pending` or `approved` row at a time (enforced in code).
 * Rejected rows are retained as an audit trail; a user may submit a new request after rejection.
 */
export const masterAccessRequests = pgTable("master_access_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  note: text("note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * User-owned TradingView webhook endpoints (Phase 5).
 *
 * Each row gives one TV alert a unique signed URL. The `mode` decides what happens
 * when an alert is accepted:
 *   - `manual_trade`     → execute a single Mudrex order on the owner's account
 *                          using the fields extracted from the alert payload.
 *   - `route_to_strategy`→ forward the alert through the existing copy-trade
 *                          mirror pipeline for the referenced strategy (must be
 *                          owned by the same user and have copy-trade webhooks
 *                          enabled).
 *
 * TV alerts themselves do not ship HMAC; we still require our
 * `X-RexAlgo-Signature` header so users can sign from any Pine `alert()` /
 * `alertcondition()` using a small helper (or Pine "Webhook URL" + static bearer
 * query-param variant). See `backend/src/lib/tvAlert.ts` for the adapter.
 */
export const tvWebhooks = pgTable("tv_webhooks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  mode: text("mode", { enum: ["manual_trade", "route_to_strategy"] })
    .notNull()
    .default("manual_trade"),
  /** Required when `mode = route_to_strategy`, must be owned by the same user. */
  strategyId: text("strategy_id").references(() => strategies.id, {
    onDelete: "set null",
  }),
  /** Max notional (USDT) per manual-trade alert — a safety cap. */
  maxMarginUsdt: doublePrecision("max_margin_usdt").notNull().default(50),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true, mode: "date" }),
  lastDeliveryAt: timestamp("last_delivery_at", {
    withTimezone: true,
    mode: "date",
  }),
});

/**
 * Durable outbox for user-facing notifications (Phase 6).
 *
 * Events are inserted from any server route; a short-interval in-process worker
 * (see `backend/src/lib/notifications.ts`) picks up `queued` rows, dispatches
 * them (currently only Telegram DM), and updates `status` + `attempts`.
 *
 * `kind` is freeform so new event types can be added without a migration;
 * `payloadJson` contains the template variables for the dispatcher.
 */
export const notificationsOutbox = pgTable("notifications_outbox", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  channel: text("channel", { enum: ["telegram"] }).notNull().default("telegram"),
  payloadJson: text("payload_json").notNull(),
  status: text("status", { enum: ["queued", "sent", "failed", "skipped"] })
    .notNull()
    .default("queued"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
});

export const tvWebhookEvents = pgTable(
  "tv_webhook_events",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => tvWebhooks.id, { onDelete: "cascade" }),
    /** Idempotency key extracted from the alert; falls back to event id. */
    idempotencyKey: text("idempotency_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", {
      enum: ["accepted", "rejected", "error"],
    }).notNull(),
    /** Freeform diagnostic line; rejection reason or Mudrex order id. */
    detail: text("detail"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    clientIp: text("client_ip"),
  },
  (t) => [uniqueIndex("tv_webhook_idem").on(t.webhookId, t.idempotencyKey)]
);
