import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  COOKIE_NAME,
  clearAllSessionCookies,
  sessionCookieWriteOptions,
} from "@/lib/auth";
import {
  authRateLimitResponse,
  checkAuthRateLimit,
  clientIpFromRequest,
} from "@/lib/authRateLimit";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

interface GoogleTokenInfo {
  aud: string;
  email: string;
  email_verified: string;
  name?: string;
  picture?: string;
  sub: string;
}

async function verifyGoogleToken(
  idToken: string
): Promise<GoogleTokenInfo | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as GoogleTokenInfo;
    if (GOOGLE_CLIENT_ID && data.aud !== GOOGLE_CLIENT_ID) return null;
    if (data.email_verified !== "true") return null;
    if (!data.email) return null;
    return data;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIpFromRequest(req);
  if (!(await checkAuthRateLimit("google", ip))) {
    const { body, status, headers } = authRateLimitResponse();
    return NextResponse.json(body, { status, headers });
  }

  let credential: unknown;
  try {
    const parsed = (await req.json()) as { credential?: unknown };
    credential = parsed?.credential;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {

    if (!credential || typeof credential !== "string") {
      return NextResponse.json(
        { error: "Google credential is required" },
        { status: 400 }
      );
    }

    const tokenInfo = await verifyGoogleToken(credential);
    if (!tokenInfo) {
      return NextResponse.json(
        { error: "Invalid or expired Google token" },
        { status: 401 }
      );
    }

    const email = tokenInfo.email.toLowerCase();
    const googleName = tokenInfo.name || email.split("@")[0];

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email));

    let userId: string;
    let userName: string;
    let encryptedKey: string | null;

    if (existing.length > 0) {
      userId = existing[0].id;
      userName = existing[0].displayName;
      encryptedKey = existing[0].apiSecretEncrypted ?? null;
    } else {
      userId = uuidv4();
      userName = googleName;
      encryptedKey = null;
      await db.insert(users).values({
        id: userId,
        email,
        authProvider: "google",
        displayName: userName,
        apiSecretEncrypted: null,
      });
    }

    const token = await createSession(userId, {
      userAgent: req.headers.get("user-agent"),
      authProvider: "google",
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: userId,
        displayName: userName,
        email,
        hasMudrexKey: encryptedKey != null,
      },
    });
    // Ensure any stale cookies on older paths are blown away before setting the new session.
    clearAllSessionCookies(response);
    response.cookies.set(COOKIE_NAME, token, sessionCookieWriteOptions());

    return response;
  } catch (error) {
    console.error("Google auth error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
