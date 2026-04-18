CREATE TABLE "tv_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_json" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_ip" text
);
--> statement-breakpoint
CREATE TABLE "tv_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mode" text DEFAULT 'manual_trade' NOT NULL,
	"strategy_id" text,
	"max_margin_usdt" double precision DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"last_delivery_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tv_webhook_events" ADD CONSTRAINT "tv_webhook_events_webhook_id_tv_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."tv_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_webhooks" ADD CONSTRAINT "tv_webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_webhooks" ADD CONSTRAINT "tv_webhooks_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tv_webhook_idem" ON "tv_webhook_events" USING btree ("webhook_id","idempotency_key");