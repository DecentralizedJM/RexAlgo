/**
 * Fail-fast helpers for required environment variables.
 *
 * Historically we had `process.env.JWT_SECRET || "rexalgo-dev-secret..."`
 * fallbacks scattered across the app. That was dangerous: a production deploy
 * with a missing env var silently booted with a secret whose value is public
 * in this repo, making every session forgeable. This module centralises the
 * "required or throw at startup" pattern so the process refuses to start
 * rather than run insecurely.
 *
 * Dev ergonomics: set `REXALGO_ALLOW_DEV_SECRETS=1` to fall back to a
 * deterministic-but-clearly-fake default (tagged with the var name so nothing
 * masquerades as a real secret). This is never honoured when
 * `NODE_ENV=production`.
 */

const DEV_FAKE_PREFIX = "dev-fake-do-not-use__";

/**
 * Returns the value of `process.env[name]`. Throws at call time if unset in
 * production, or if unset in dev without `REXALGO_ALLOW_DEV_SECRETS=1`.
 *
 * `name` is assumed to be ASCII uppercase (no leaking of exotic var names).
 */
export function requireSecretEnv(name: string): string {
  const raw = process.env[name];
  if (typeof raw === "string" && raw.trim() !== "") return raw;

  if (
    process.env.NODE_ENV !== "production" &&
    process.env.REXALGO_ALLOW_DEV_SECRETS === "1"
  ) {
    // Deterministic-but-obviously-fake — includes the var name so nothing in
    // logs can be mistaken for a real secret.
    return `${DEV_FAKE_PREFIX}${name}`;
  }

  throw new Error(
    `[requireSecretEnv] ${name} is required but not set. ` +
      "Set it in your environment (backend/.env.local for dev, Railway/Vercel " +
      "for prod) or export REXALGO_ALLOW_DEV_SECRETS=1 for non-production boot."
  );
}

/** Like {@link requireSecretEnv} but returns `null` when unset (opt-in). */
export function optionalEnv(name: string): string | null {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}
