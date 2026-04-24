import { NextRequest, NextResponse } from "next/server";
import { validateApiSecret } from "@/lib/mudrex";
import {
  encryptApiSecret,
  createSession,
  COOKIE_NAME,
  clearAllSessionCookies,
  sessionCookieWriteOptions,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const { apiSecret, displayName } = await req.json();

    if (!apiSecret || typeof apiSecret !== "string") {
      return NextResponse.json(
        { error: "API secret is required" },
        { status: 400 }
      );
    }

    const isValid = await validateApiSecret(apiSecret.trim());
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid API secret. Could not authenticate with Mudrex." },
        { status: 401 }
      );
    }

    const encrypted = encryptApiSecret(apiSecret.trim());

    const secretHash = Buffer.from(apiSecret.trim()).toString("base64").slice(0, 16);
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.id, secretHash));

    let userId: string;
    let userName: string;

    if (existingUsers.length > 0) {
      userId = existingUsers[0].id;
      const incoming = displayName?.trim();
      userName = incoming || existingUsers[0].displayName;
      await db
        .update(users)
        .set({
          apiSecretEncrypted: encrypted,
          ...(incoming ? { displayName: incoming } : {}),
        })
        .where(eq(users.id, userId));
    } else {
      userId = secretHash;
      userName = displayName?.trim() || "Trader";
      await db.insert(users).values({
        id: userId,
        displayName: userName,
        apiSecretEncrypted: encrypted,
      });
    }

    const token = await createSession(userId, {
      userAgent: req.headers.get("user-agent"),
      authProvider: "mudrex_legacy",
    });

    const response = NextResponse.json({ success: true, user: { id: userId, displayName: userName } });
    clearAllSessionCookies(response);
    response.cookies.set(COOKIE_NAME, token, sessionCookieWriteOptions());

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 }
    );
  }
}
