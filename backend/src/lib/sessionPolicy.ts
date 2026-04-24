/**
 * Optional mass sign-out for stateless session JWTs (no server session table).
 *
 * When set, {@link sessionJwtIssuedAtAllowed} is false for tokens whose `iat`
 * is strictly before this Unix timestamp — users must sign in again.
 *
 * Does not apply to short-lived Telegram link JWTs (separate verify path).
 */

export function getSessionMinIatUnix(): number | null {
  const raw = process.env.REXALGO_SESSION_MIN_IAT?.trim();
  if (raw === undefined || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function sessionJwtIssuedAtAllowed(iat: unknown): boolean {
  const min = getSessionMinIatUnix();
  if (min === null) return true;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return false;
  return iat >= min;
}
