/**
 * Deterministic user fingerprint for the legacy Mudrex-API-secret login flow.
 *
 * Historically, the first 16 base64 chars of the API secret were used as
 * `users.id`. That leaked the secret into the primary key and made secret
 * rotation impossible without orphaning every foreign key. Audit item #3.
 *
 * The fingerprint is `HMAC-SHA256(FINGERPRINT_SECRET, apiSecret)` hex-encoded.
 *
 *   - Deterministic: the same secret always yields the same fingerprint, so
 *     we can look up the row on the next login.
 *   - Non-invertible: without `FINGERPRINT_SECRET`, a dump of this column
 *     tells an attacker nothing about the plaintext secret.
 *   - Collision-resistant: SHA-256 means two distinct secrets effectively
 *     never collide (the UNIQUE index enforces it at the DB level anyway).
 *
 * `FINGERPRINT_SECRET` is a required env var (32 random hex bytes). Rotating
 * it invalidates every fingerprint — if it has to be rotated, run the
 * backfill script with the new secret first, then swap the env var.
 */
import crypto from "crypto";
import { requireSecretEnv } from "@/lib/requireEnv";

export function computeUserSecretFingerprint(apiSecret: string): string {
  const key = requireSecretEnv("FINGERPRINT_SECRET");
  return crypto
    .createHmac("sha256", key)
    .update(apiSecret.trim(), "utf8")
    .digest("hex");
}
