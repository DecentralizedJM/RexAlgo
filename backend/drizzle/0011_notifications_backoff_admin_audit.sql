-- Per-row retry scheduling for the notifications outbox (exponential backoff in app code).
ALTER TABLE "notifications_outbox" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone;
ALTER TABLE "notifications_outbox" ADD COLUMN IF NOT EXISTS "consecutive_failures" integer NOT NULL DEFAULT 0;

-- Immutable admin action log (mutations under /api/admin/**).
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" text PRIMARY KEY,
  "actor_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "detail_json" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "admin_audit_log_created_at_idx" ON "admin_audit_log" ("created_at" DESC);
