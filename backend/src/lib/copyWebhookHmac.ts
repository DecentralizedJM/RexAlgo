/**
 * HMAC verification for copy-trading webhooks (master’s external bot).
 * Header: X-RexAlgo-Signature: t=<unixSeconds>,v1=<hex>
 * Signed payload: `${t}.${rawBody}`
 */
import crypto from "crypto";

const SIG_HEADER = "x-rexalgo-signature";
const MAX_SKEW_SEC = 300;

export function buildSignature(secret: string, timestampSec: number, rawBody: string): string {
  const payload = `${timestampSec}.${rawBody}`;
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verifyCopyWebhookSignature(
  secret: string,
  rawBody: string,
  headers: Headers
): { ok: true } | { ok: false; reason: string } {
  const header = headers.get(SIG_HEADER);
  if (!header) {
    return { ok: false, reason: "Missing X-RexAlgo-Signature header" };
  }

  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.trim().split("=");
      return [k, rest.join("=")];
    })
  ) as Record<string, string>;

  const t = parts.t ? parseInt(parts.t, 10) : NaN;
  const v1 = parts.v1;

  if (!Number.isFinite(t) || !v1) {
    return { ok: false, reason: "Invalid signature format (expected t=...,v1=...)" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > MAX_SKEW_SEC) {
    return { ok: false, reason: "Timestamp outside allowed window" };
  }

  const expected = buildSignature(secret, t, rawBody);
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0 || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "Invalid signature" };
  }

  return { ok: true };
}

export { SIG_HEADER };
