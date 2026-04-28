-- Persist the dashboard "It's ok" acknowledgement for the shared-Mudrex-key
-- warning. Previously stored only in `sessionStorage`, which meant the warning
-- reappeared on every fresh login on the same machine. We now key the
-- acknowledgement on the user's current Mudrex key fingerprint and client IP
-- so the warning stays hidden until either rotates (key change ⇒ new
-- fingerprint, machine/network change ⇒ new IP). See
-- `backend/src/lib/mudrexKeySharing.ts` for the read path.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "shared_mudrex_ack_fingerprint" text,
  ADD COLUMN IF NOT EXISTS "shared_mudrex_ack_ip" text,
  ADD COLUMN IF NOT EXISTS "shared_mudrex_ack_at" timestamptz;
