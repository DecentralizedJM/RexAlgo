-- Admin dashboard v2
--   * Per-strategy approval workflow (strategies.status / rejection_reason /
--     reviewed_by / reviewed_at). Existing rows are migrated to `pending` so
--     admins can re-review the catalogue.
--   * master_access_requests.contact_phone — required on new requests; we
--     backfill empty for legacy rows (UI keeps them as-is).
--   * trade_logs.source / notional_usdt + (user_id, created_at) index so the
--     admin dashboard can aggregate per-user volume efficiently.

ALTER TABLE "strategies"
  ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "rejection_reason" text;
--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "reviewed_by" text;
--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "strategies"
  ADD CONSTRAINT "strategies_reviewed_by_users_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Re-review the entire existing catalogue (explicit, idempotent UPDATE — the
-- column default already fills this for fresh installs).
UPDATE "strategies" SET "status" = 'pending';
--> statement-breakpoint

ALTER TABLE "master_access_requests"
  ADD COLUMN "contact_phone" text DEFAULT '' NOT NULL;
--> statement-breakpoint

ALTER TABLE "trade_logs"
  ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "trade_logs" ADD COLUMN "notional_usdt" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_logs_user_created_idx"
  ON "trade_logs" ("user_id", "created_at");
