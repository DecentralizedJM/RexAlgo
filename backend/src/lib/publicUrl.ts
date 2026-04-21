import type { NextRequest } from "next/server";

function parsePublicAppUrlOrigin(): string | null {
  const raw = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? "";
  if (!raw) return null;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function looksLikeRailwayInternalHost(host: string): boolean {
  return /\.railway\.app$/i.test(host);
}

/**
 * Origin users see in the address bar (SPA), e.g. `https://rexalgo.xyz`.
 *
 * Use for **OAuth redirects** when the API process runs on Railway (or any
 * host) but the browser reached it via a reverse proxy: `x-forwarded-host` /
 * `x-forwarded-proto` carry the public hostname. If your proxy strips them,
 * set `PUBLIC_APP_URL` to that same SPA origin (with or without `https://`).
 *
 * If `X-Forwarded-Host` is a `*.railway.app` hostname (mis-set proxy), we
 * prefer `PUBLIC_APP_URL` when configured so users are not redirected to the
 * raw Railway URL.
 */
export function browserPublicOriginFromRequest(req: NextRequest): string {
  const xfHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const xfProto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const appOrigin = parsePublicAppUrlOrigin();

  if (xfHost && !looksLikeRailwayInternalHost(xfHost)) {
    return `${xfProto}://${xfHost}`;
  }
  if (appOrigin) {
    return appOrigin;
  }
  if (xfHost) {
    return `${xfProto}://${xfHost}`;
  }
  return req.nextUrl.origin;
}

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
