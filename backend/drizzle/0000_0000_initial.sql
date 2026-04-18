CREATE TABLE "copy_mirror_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"detail" text NOT NULL,
	"mudrex_order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_signal_events" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_json" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_ip" text
);
--> statement-breakpoint
CREATE TABLE "copy_webhook_config" (
	"strategy_id" text PRIMARY KEY NOT NULL,
	"secret_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"creator_name" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"leverage" text DEFAULT '1' NOT NULL,
	"stoploss_pct" double precision,
	"takeprofit_pct" double precision,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"timeframe" text DEFAULT '1h',
	"backtest_spec_json" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"total_pnl" double precision DEFAULT 0 NOT NULL,
	"win_rate" double precision DEFAULT 0 NOT NULL,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"subscriber_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"margin_per_trade" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text,
	"order_id" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"quantity" text NOT NULL,
	"entry_price" text,
	"exit_price" text,
	"pnl" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"auth_provider" text DEFAULT 'legacy' NOT NULL,
	"display_name" text NOT NULL,
	"api_secret_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "copy_mirror_attempts" ADD CONSTRAINT "copy_mirror_attempts_signal_id_copy_signal_events_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."copy_signal_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_mirror_attempts" ADD CONSTRAINT "copy_mirror_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_signal_events" ADD CONSTRAINT "copy_signal_events_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_webhook_config" ADD CONSTRAINT "copy_webhook_config_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_logs" ADD CONSTRAINT "trade_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_logs" ADD CONSTRAINT "trade_logs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "copy_signal_strategy_idem" ON "copy_signal_events" USING btree ("strategy_id","idempotency_key");