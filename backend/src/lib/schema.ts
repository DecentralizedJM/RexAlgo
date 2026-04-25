/**
 * Drizzle schema (Postgres): users, strategies, subscriptions, trade logs, copy webhook config/events.
 * Timestamps are `timestamp with time zone` (UTC).
 *
 * Later phases extend this file with additional tables:
 *   Phase 2: masterAccessRequests
 *   Phase 5: TradingView webhooks (tv_webhooks, tv_webhook_events)
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
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  authProvider: text("auth_provider").notNull().default("legacy"),
  displayName: text("display_name").notNull(),
  apiSecretEncrypted: text("api_secret_encrypted"),
  /**
   * Deterministic HMAC-SHA256 of the Mudrex API secret, keyed by
   * `FINGERPRINT_SECRET`. Lets the legacy Mudrex-key login endpoint look up
   * existing accounts without storing the plaintext secret and without using
   * a prefix of the secret as the primary key (the original, very bad
   * design this migration fixes). Nullable because Google-only users never
   * set this.
   *
   * Hex-encoded (64 chars). Unique so we can detect key reuse across accounts.
   */
  userSecretFingerprint: text("user_secret_fingerprint").unique(),
  /** Telegram numeric user id (as string to dodge 53-bit JS number limits). */
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  /**
   * Private chat id for this user. For private chats Telegram guarantees
   * `chat.id === from.id`, so this mirrors `telegramId` most of the time, but
   * we keep it as a separate column so future bot-initiated DMs can address
   * channels/groups without schema changes.
   */
  telegramChatId: text("telegram_chat_id"),
  /**
   * `true` once the user has tapped `/start` on the bot at least once. This is
   * what unlocks DM delivery: without a started chat, the Bot API refuses the
   * first `sendMessage`. The bot-first login flow sets this during `/start`.
   */
  telegramConnected: boolean("telegram_connected").notNull().default(false),
  /** When true, we enqueue Telegram DMs for notable events (see notificationsOutbox). */
  telegramNotifyEnabled: boolean("telegram_notify_enabled")
    .notNull()
    .default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * Short-lived login intents for the bot-first Telegram sign-in flow
 * (`backend/src/lib/telegramBotAuth.ts`).
 *
 * Lifecycle:
 *   pending  → row just created by POST /api/auth/telegram/start. The token
 *              is embedded in a `t.me/<bot>?start=rexalgo_<token>` deep link.
 *   claimed  → bot webhook received `/start rexalgo_<token>` from a Telegram
 *              user; the row now carries `userId` + `telegramId` and the
 *              frontend poll can mint a session cookie.
 *   used     → poll endpoint minted the session and consumed the token. No
 *              further polls will succeed for this token.
 *   expired  → token TTL elapsed before claim.
 *
 * `linkUserId` is set when the start request came from an already-authenticated
 * browser (Settings → "Connect Telegram"). In that case the webhook links the
 * Telegram account to the existing user instead of creating a new one.
 */
export const telegramLoginTokens = pgTable("telegram_login_tokens", {
  token: text("token").primaryKey(),
  status: text("status", {
    enum: ["pending", "claimed", "used", "expired"],
  })
    .notNull()
    .default("pending"),
  /** Set when the start request carried a session cookie (link flow). */
  linkUserId: text("link_user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  /** Populated by the webhook once the user taps `/start`. */
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  telegramId: text("telegram_id"),
  telegramUsername: text("telegram_username"),
  /** Path to navigate to after the poll succeeds. */
  returnPath: text("return_path"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
    .notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
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
  /**
   * Per-strategy admin review state.
   *   pending  → default for new and re-submitted listings. Hidden from public
   *              listings; webhook deliveries are rejected.
   *   approved → public listing enabled; webhook may be enabled by owner.
   *   rejected → hidden from public; owner may edit, resubmit, or delete.
   * Existing pre-v2 rows were migrated to `pending` on deployment.
   */
  status: text("status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  rejectionReason: text("rejection_reason"),
  reviewedBy: text("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
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

/**
 * Forward-looking local ledger of every order RexAlgo placed on the user's behalf.
 * Used to aggregate per-user trading volume in the admin dashboard.
 *
 * `source` distinguishes the code path that placed the order:
 *   manual → dashboard / mobile ad-hoc order (`/api/mudrex/orders`)
 *   copy   → copy-trade mirror fill (`lib/copyMirror.ts`)
 *   tv     → TradingView webhook manual_trade (`/api/webhooks/tv/[id]`)
 *
 * `notionalUsdt` is stored as a numeric string (mirrors the rest of the
 * money-field convention). It is `qty * orderPrice` (or last-known mark price
 * when order price is not available).
 */
export const tradeLogs = pgTable(
  "trade_logs",
  {
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
    /** Which code path placed this order (see table docstring). */
    source: text("source", { enum: ["manual", "copy", "tv"] })
      .notNull()
      .default("manual"),
    /** Order notional (qty * price) at fill time, USDT, numeric string. */
    notionalUsdt: text("notional_usdt"),
    status: text("status", { enum: ["open", "closed", "cancelled"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("trade_logs_user_created_idx").on(t.userId, t.createdAt)]
);

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
  /**
   * Required contact phone the RexAlgo team can use to follow up (any format;
   * server validates length + a permissive character set so users can pass
   * local or international numbers). Empty string for pre-v2 rows.
   */
  contactPhone: text("contact_phone").notNull().default(""),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * User-owned TradingView webhook endpoints (Phase 5).
 *
 * Each row gives one TradingView alert a unique signed URL. The `mode` decides
 * what happens when an alert is accepted:
 *   - `manual_trade`     → execute a single Mudrex order on the owner's account
 *                          using the fields extracted from the alert payload.
 *   - `route_to_strategy`→ forward the alert through the existing copy-trade
 *                          mirror pipeline for the referenced strategy (must be
 *                          owned by the same user and have copy-trade webhooks
 *                          enabled).
 *
 * TradingView does not attach custom headers; callers sign the JSON body and set
 * `X-RexAlgo-Signature` from a tiny proxy or worker. See `backend/src/lib/tvAlert.ts`.
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
  /** Used when the alert JSON omits `leverage` (manual_trade). */
  defaultLeverage: doublePrecision("default_leverage").notNull().default(5),
  /**
   * Used when the alert omits `risk_pct`: margin = futures_wallet × pct/100,
   * clamped to `max_margin_usdt`.
   */
  defaultRiskPct: doublePrecision("default_risk_pct").notNull().default(2),
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
  status: text("status", {
    enum: ["queued", "processing", "sent", "failed", "skipped"],
  })
    .notNull()
    .default("queued"),
  attempts: integer("attempts").notNull().default(0),
  /** Consecutive soft delivery failures for this row (resets on successful send). */
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  /** When set and in the future, the worker skips this row until the timestamp. */
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: "date" }),
  /** Lease expiry for replica-safe outbox workers. */
  processingExpiresAt: timestamp("processing_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
});

/**
 * Append-only log of admin mutations (strategy review, toggles, master access, etc.).
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detailJson: text("detail_json"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("admin_audit_log_created_at_idx").on(t.createdAt)]
);

/**
 * Server-side session rows for the browser cookie (`rexalgo_session`).
 *
 * The cookie is a short JWS carrying just `sid` (+ `exp` / `iat`). Every
 * request loads the row to confirm the session is still valid — that makes
 * per-device logout and admin revoke a one-row update instead of a global
 * `JWT_SECRET` / `REXALGO_SESSION_MIN_IAT` rotation.
 *
 * We never trust user data from the cookie beyond the session id; display
 * name, email, and the encrypted Mudrex secret live on `users` and are read
 * fresh on each `getSession()` call.
 *
 * Hot path: primary-key lookup on `id`. Admin "list my sessions" and cleanup
 * jobs use the secondary indexes below.
 */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Optional first-party context captured at login — never indexed, never
     * promoted to PII beyond a coarse "Chrome on macOS" string the user sees
     * in a future device list. Kept NULL-safe.
     */
    userAgent: text("user_agent"),
    /** Login kind so device lists can surface "Google" / "Telegram". */
    authProvider: text("auth_provider").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    /** Set when the user (or an admin) invalidates this specific session. */
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("user_sessions_user_idx").on(t.userId),
    index("user_sessions_expires_idx").on(t.expiresAt),
  ]
);

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
