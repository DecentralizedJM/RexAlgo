/**
 * HMAC verification for copy-trading webhooks (master’s external bot).
 * Header: X-RexAlgo-Signature: t=<unixSeconds>,v1=<hex>
 * Signed payload: `${t}.${rawBody}`
 *
 * The replay window was reduced from 300s to 60s. The copy-signal idempotency
 * key prevents duplicate mirror fills, but an attacker can vary the key to
 * sidestep it — trimming the window shrinks the replay surface. Operators
 * whose bots run with clock skew can raise the bound via
 * `REXALGO_WEBHOOK_MAX_SKEW_SEC` (30–900 accepted).
 */
import crypto from "crypto";

const SIG_HEADER = "x-rexalgo-signature";
const DEFAULT_MAX_SKEW_SEC = 60;
const MAX_SKEW_FLOOR = 30;
const MAX_SKEW_CEILING = 900;

function resolvedMaxSkewSec(): number {
  const raw = process.env.REXALGO_WEBHOOK_MAX_SKEW_SEC;
  if (!raw) return DEFAULT_MAX_SKEW_SEC;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_SKEW_SEC;
  return Math.min(MAX_SKEW_CEILING, Math.max(MAX_SKEW_FLOOR, n));
}

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
  if (Math.abs(now - t) > resolvedMaxSkewSec()) {
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
