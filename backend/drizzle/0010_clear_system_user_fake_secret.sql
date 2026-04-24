-- The catalogue `system` user was seeded with `api_secret_encrypted = 'system-no-api'`
-- as a placeholder. That is not valid AES-GCM ciphertext and breaks any code path
-- that tries to decrypt it (e.g. fingerprint backfill). The system account has no
-- Mudrex key — the column should be NULL.
UPDATE "users"
SET "api_secret_encrypted" = NULL
WHERE "id" = 'system'
  AND "api_secret_encrypted" = 'system-no-api';
