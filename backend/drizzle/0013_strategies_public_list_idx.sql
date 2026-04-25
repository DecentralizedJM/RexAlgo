-- Speeds public marketplace listing: approved + active, ordered by created_at.
CREATE INDEX IF NOT EXISTS "strategies_public_list_idx"
  ON "strategies" ("created_at" DESC)
  WHERE "status" = 'approved' AND "is_active" = true;
