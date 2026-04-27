ALTER TABLE "strategies"
  ADD COLUMN IF NOT EXISTS "asset_mode" text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS "symbols_json" text;

UPDATE "strategies"
SET "symbols_json" = json_build_array("symbol")::text
WHERE "symbols_json" IS NULL;

CREATE TABLE IF NOT EXISTS "strategy_slot_extension_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "strategy_type" text NOT NULL DEFAULT 'algo',
  "requested_slots" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'pending',
  "note" text,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "strategy_slot_ext_user_type_status_idx"
  ON "strategy_slot_extension_requests" ("user_id", "strategy_type", "status");
