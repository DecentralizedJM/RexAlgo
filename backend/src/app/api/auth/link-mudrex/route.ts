import { NextRequest, NextResponse } from "next/server";
import { validateApiSecret } from "@/lib/mudrex";
import { getSession, encryptApiSecret } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { apiSecret } = await req.json();

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

    await db
      .update(users)
      .set({ apiSecretEncrypted: encrypted })
      .where(eq(users.id, session.user.id));

    // The session cookie references `user_sessions.id`; the Mudrex secret is
    // loaded fresh from `users` on each `getSession()` call, so we no longer
    // need to re-issue the cookie on link/unlink.
    return NextResponse.json({
      success: true,
      user: {
        id: session.user.id,
        displayName: session.user.displayName,
        email: session.user.email,
        hasMudrexKey: true,
      },
    });
  } catch (error) {
    console.error("Link Mudrex error:", error);
    return NextResponse.json(
      { error: "Failed to link Mudrex API key" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await db
      .update(users)
      .set({ apiSecretEncrypted: null })
      .where(eq(users.id, session.user.id));

    return NextResponse.json({
      success: true,
      user: {
        id: session.user.id,
        displayName: session.user.displayName,
        email: session.user.email,
        hasMudrexKey: false,
      },
    });
  } catch (error) {
    console.error("Unlink Mudrex error:", error);
    return NextResponse.json(
      { error: "Failed to unlink Mudrex API key" },
      { status: 500 }
    );
  }
}
