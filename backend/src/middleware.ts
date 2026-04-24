/**
 * Fast gate for authenticated /api/* routes. No HTML UI on this server —
 * always JSON 401. Public: GET /api/strategies (and GET /api/strategies/[id]).
 * Public (HMAC): POST /api/webhooks/copy-trading/* — not matched here.
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

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "rexalgo-dev-secret-change-in-production-2024"
);

const COOKIE_NAME = "rexalgo_session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/strategies") && req.method === "GET") {
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/api/mudrex") ||
    pathname.startsWith("/api/strategies") ||
    pathname.startsWith("/api/subscriptions")
  ) {
    const token = req.cookies.get(COOKIE_NAME)?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      const sid = typeof payload.sid === "string" ? payload.sid : "";
      if (!sid || !sessionJwtIssuedAtAllowed(payload.iat)) {
        return NextResponse.json({ error: "Session expired" }, { status: 401 });
      }
      return NextResponse.next();
    } catch {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/mudrex/:path*",
    "/api/strategies/:path*",
    "/api/subscriptions/:path*",
    "/api/copy-trading/:path*",
    "/api/marketplace/studio/:path*",
  ],
};
