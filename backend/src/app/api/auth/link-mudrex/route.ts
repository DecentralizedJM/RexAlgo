import { NextRequest, NextResponse } from "next/server";
import { validateApiSecret } from "@/lib/mudrex";
import { getSession, encryptApiSecret } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { tryComputeUserSecretFingerprint } from "@/lib/userFingerprint";
import { userHasSharedMudrexKey } from "@/lib/mudrexKeySharing";

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

    const trimmed = apiSecret.trim();
    const encrypted = encryptApiSecret(trimmed);
    const fingerprint = tryComputeUserSecretFingerprint(trimmed);

    // Wipe any prior shared-key ack: a new fingerprint must re-trigger the
    // warning if the new secret is also shared, otherwise the previous "It's
    // ok" silently covers a different key. See `mudrexKeySharing.ts`.
    await db
      .update(users)
      .set({
        apiSecretEncrypted: encrypted,
        userSecretFingerprint: fingerprint ?? null,
        sharedMudrexAckFingerprint: null,
        sharedMudrexAckIp: null,
        sharedMudrexAckAt: null,
      })
      .where(eq(users.id, session.user.id));

    const mudrexKeySharedAcrossAccounts = await userHasSharedMudrexKey(
      session.user.id
    );

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
        mudrexKeySharedAcrossAccounts,
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
    // Unlinking the key removes the basis for any prior ack — clear all three
    // columns so a future re-link starts the warning state from scratch.
    await db
      .update(users)
      .set({
        apiSecretEncrypted: null,
        userSecretFingerprint: null,
        sharedMudrexAckFingerprint: null,
        sharedMudrexAckIp: null,
        sharedMudrexAckAt: null,
      })
      .where(eq(users.id, session.user.id));

    return NextResponse.json({
      success: true,
      user: {
        id: session.user.id,
        displayName: session.user.displayName,
        email: session.user.email,
        hasMudrexKey: false,
        mudrexKeySharedAcrossAccounts: false,
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
