/**
 * Protects authenticated /api/* routes. No HTML UI on this server — always JSON 401.
 * Public: GET /api/strategies (and GET /api/strategies/[id]).
 * Public (HMAC): POST /api/webhooks/copy-trading/* — not matched here.
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
      if (
        typeof payload.userId !== "string" ||
        !payload.userId ||
        !sessionJwtIssuedAtAllowed(payload.iat)
      ) {
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
