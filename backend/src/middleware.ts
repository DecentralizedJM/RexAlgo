/**
 * Protects /dashboard and most /api/* except public GET /api/strategies.
 * Validates JWT from cookie; API returns 401, pages redirect to /login.
 * @see README.md#architecture — backend modules
 */
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "rexalgo-dev-secret-change-in-production-2024"
);

const COOKIE_NAME = "rexalgo_session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/strategies") && req.method === "GET") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api/mudrex") || pathname.startsWith("/api/strategies") || pathname.startsWith("/api/subscriptions")) {
    const token = req.cookies.get(COOKIE_NAME)?.value;

    if (!token) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", req.url));
    }

    try {
      await jwtVerify(token, JWT_SECRET);
      return NextResponse.next();
    } catch {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Session expired" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/mudrex/:path*", "/api/strategies/:path*", "/api/subscriptions/:path*"],
};
