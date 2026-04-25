-- Replica-safe notification claiming and worker hot-path indexes.
ALTER TABLE "notifications_outbox"
  ADD COLUMN IF NOT EXISTS "processing_expires_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "notifications_outbox_claim_idx"
  ON "notifications_outbox" ("channel", "status", "next_retry_at", "created_at")
  WHERE "status" IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS "notifications_outbox_created_at_idx"
  ON "notifications_outbox" ("created_at" DESC);
