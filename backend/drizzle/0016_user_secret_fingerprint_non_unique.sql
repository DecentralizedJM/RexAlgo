-- Allow the same Mudrex API secret fingerprint on multiple `users` rows so we
-- can detect "one Mudrex key linked across several RexAlgo accounts" and warn
-- in the product. Legacy behaviour used a UNIQUE index so only one row could
-- carry a fingerprint — the backfill skipped duplicates and link-mudrex never
-- wrote the column, which hid the issue entirely.
DROP INDEX IF EXISTS "users_user_secret_fingerprint_unique";
CREATE INDEX IF NOT EXISTS "users_user_secret_fingerprint_idx"
  ON "users" ("user_secret_fingerprint");
