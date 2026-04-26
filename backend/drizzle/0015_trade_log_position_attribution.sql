-- Store Mudrex position ids for RexAlgo-created trades when Mudrex exposes them.
-- This lets the dashboard split "All Mudrex" from "RexAlgo" more accurately
-- for newly attributed positions/history while preserving legacy rows.
ALTER TABLE "trade_logs" ADD COLUMN IF NOT EXISTS "position_id" text;
--> statement-breakpoint
ALTER TABLE "trade_logs" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_logs_user_position_idx"
  ON "trade_logs" ("user_id", "position_id");
