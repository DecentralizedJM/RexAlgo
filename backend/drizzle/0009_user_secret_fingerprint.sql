-- Phase 2 / audit #3: stop deriving user primary keys from a prefix of the
-- Mudrex API secret. The prior scheme
--     userId = base64(apiSecret).slice(0, 16)
-- leaked 16 bytes of the secret into the primary key (and into every
-- foreign key pointing at it), and collided silently when two users chose
-- pathologically similar secrets.
--
-- Going forward:
--   * New legacy-login users get `id = uuid()` (same as Google users).
--   * `user_secret_fingerprint = HMAC-SHA256(FINGERPRINT_SECRET, apiSecret)`
--     is what we look up on subsequent logins. The column is unique so a
--     single secret always resolves to the same row.
--
-- Additive migration only — existing rows keep their id, and a one-off
-- backfill script populates the fingerprint (see
-- `backend/scripts/backfill-user-fingerprint.ts`). Nothing breaks if the
-- backfill is deferred; the next login for that user simply falls through
-- to the "create a new row" branch, which is the behaviour we had before.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "user_secret_fingerprint" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_user_secret_fingerprint_unique"
  ON "users" ("user_secret_fingerprint");
