import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  COOKIE_NAME,
  SESSION_COOKIE_PATH,
  clearAllSessionCookies,
  getSessionMaxAgeSeconds,
} from "@/lib/auth";
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
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
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
  try {
    const { credential } = await req.json();

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

    const token = await createSession(userId, userName, encryptedKey, email);

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
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: getSessionMaxAgeSeconds(),
      path: SESSION_COOKIE_PATH,
    });

    return response;
  } catch (error) {
    console.error("Google auth error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
