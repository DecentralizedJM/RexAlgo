/**
 * Fast gate for authenticated /api/* routes. No HTML UI on this server —
 * always JSON 401. Public: GET /api/strategies (and GET /api/strategies/[id]).
 * Public (HMAC): POST /api/webhooks/strategy/* (and legacy /copy-trading/*) — not matched here.
 *
 * Runtime: Edge (default for Next middleware). We **only** verify the JWS
 * signature + expiry + (optional) session floor. The full revocation check
 * (is `user_sessions.revoked_at` null? has it expired? does the user still
 * exist?) happens in the Node route layer via `getSession()` so we don't
 * pull `pg` / `ioredis` into the Edge bundle.
 *
 * The cookie's only meaningful claim is `sid`; its value is a random 256-bit
 * id that indexes `user_sessions`. An attacker with a stolen cookie cannot
 * bypass Postgres — revoking the row locks them out within one request.
 *
 * @see backend/src/lib/auth.ts (`createSession`, `getSession`)
 * @see README.md#architecture
 */
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { sessionJwtIssuedAtAllowed } from "@/lib/sessionPolicy";
import { requireSecretEnv } from "@/lib/requireEnv";

// Fail-fast: production deploy with missing JWT_SECRET must not boot. The
// middleware runs on Edge but `requireSecretEnv` has no Node dependencies.
const JWT_SECRET = new TextEncoder().encode(requireSecretEnv("JWT_SECRET"));

const COOKIE_NAME = "rexalgo_session";

/**
 * Defence-in-depth HTTP response headers. These are cheap, apply to every API
 * response, and reduce the blast radius of common web-app exploits:
 *
 *   - `X-Frame-Options: DENY` / `frame-ancestors 'none'` — block clickjacking
 *     (the SPA never embeds the API in an iframe).
 *   - `X-Content-Type-Options: nosniff` — browsers must trust our
 *     `Content-Type` instead of guessing (avoids MIME confusion XSS).
 *   - `Referrer-Policy: strict-origin-when-cross-origin` — don't leak paths
 *     or query strings to third-party origins when the SPA links outward.
 *   - `Strict-Transport-Security` (prod only) — forbid plaintext fallback
 *     from any browser that has seen this header.
 *   - `Cross-Origin-Opener-Policy: same-origin` — isolates the window group
 *     so popups (e.g. Google OAuth) can't poke at our window object.
 */
function applySecurityHeaders(res: NextResponse, requestId?: string): NextResponse {
  if (requestId) {
    res.headers.set("X-Request-Id", requestId);
  }
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const incomingRid = req.headers.get("x-request-id")?.trim();
  const requestId =
    incomingRid && incomingRid.length > 0 && incomingRid.length <= 128
      ? incomingRid
      : globalThis.crypto.randomUUID();

  const forwardHeaders = new Headers(req.headers);
  forwardHeaders.set("x-request-id", requestId);

  if (pathname.startsWith("/api/strategies") && req.method === "GET") {
    return applySecurityHeaders(
      NextResponse.next({ request: { headers: forwardHeaders } }),
      requestId
    );
  }

  if (
    pathname.startsWith("/api/mudrex") ||
    pathname.startsWith("/api/strategies") ||
    pathname.startsWith("/api/subscriptions")
  ) {
    const token = req.cookies.get(COOKIE_NAME)?.value;

    if (!token) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      return applySecurityHeaders(res, requestId);
    }

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      const sid = typeof payload.sid === "string" ? payload.sid : "";
      if (!sid || !sessionJwtIssuedAtAllowed(payload.iat)) {
        const res = NextResponse.json({ error: "Session expired" }, { status: 401 });
        return applySecurityHeaders(res, requestId);
      }
      return applySecurityHeaders(
        NextResponse.next({ request: { headers: forwardHeaders } }),
        requestId
      );
    } catch {
      const res = NextResponse.json({ error: "Session expired" }, { status: 401 });
      return applySecurityHeaders(res, requestId);
    }
  }

  return applySecurityHeaders(
    NextResponse.next({ request: { headers: forwardHeaders } }),
    requestId
  );
}

export const config = {
  matcher: [
    // Include every /api/* route so security headers apply universally.
    // The session-gate branch above still only runs on its specific paths.
    "/api/:path*",
  ],
};
