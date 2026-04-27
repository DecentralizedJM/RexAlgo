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
 *     never collide. The DB column is no longer UNIQUE so the same secret can
 *     exist on multiple RexAlgo accounts (we warn in the UI when that happens).
 *
 * `FINGERPRINT_SECRET` is a required env var (32 random hex bytes). Rotating
 * it invalidates every fingerprint — if it has to be rotated, run the
 * backfill script with the new secret first, then swap the env var.
 */
import crypto from "crypto";
import { optionalEnv, requireSecretEnv } from "@/lib/requireEnv";

export function computeUserSecretFingerprint(apiSecret: string): string {
  const key = requireSecretEnv("FINGERPRINT_SECRET");
  return crypto
    .createHmac("sha256", key)
    .update(apiSecret.trim(), "utf8")
    .digest("hex");
}

/**
 * Same HMAC as {@link computeUserSecretFingerprint} but returns `null` when
 * `FINGERPRINT_SECRET` is unset (e.g. misconfigured dev) so link-mudrex can
 * still save the encrypted secret without throwing.
 */
export function tryComputeUserSecretFingerprint(apiSecret: string): string | null {
  const key = optionalEnv("FINGERPRINT_SECRET")?.trim();
  if (!key) return null;
  return crypto
    .createHmac("sha256", key)
    .update(apiSecret.trim(), "utf8")
    .digest("hex");
}
