/**
 * The stable public origin of the Next API (no trailing slash).
 *
 * Priority:
 *   1. `PUBLIC_API_URL` (recommended; prod should be `https://api.rexalgo.xyz`)
 *   2. `PUBLIC_APP_URL` (legacy, kept for backward compatibility)
 *   3. `NEXT_PUBLIC_APP_URL` (legacy)
 *
 * Returns `""` when none are set — studio UIs then fall back to the browser origin,
 * which is fine for local dev but must be configured in production so webhook URLs
 * point to the API and not the frontend CDN.
 *
 * @see backend/.env.example
 */
export function publicApiBase(): string {
  const base =
    process.env.PUBLIC_API_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "";
  return base.replace(/\/$/, "");
}

/**
 * `true` when the public API base is configured (no runtime fallback needed).
 */
export function hasPublicApiBase(): boolean {
  return publicApiBase().length > 0;
}
