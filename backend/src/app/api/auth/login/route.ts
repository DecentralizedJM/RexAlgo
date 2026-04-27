import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { validateApiSecret } from "@/lib/mudrex";
import {
  encryptApiSecret,
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
import { computeUserSecretFingerprint } from "@/lib/userFingerprint";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { asc, eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const ip = clientIpFromRequest(req);
  if (!(await checkAuthRateLimit("login", ip))) {
    const { body, status, headers } = authRateLimitResponse();
    return NextResponse.json(body, { status, headers });
  }

  let apiSecret: string;
  let displayName: string | undefined;
  try {
    const parsed = (await req.json()) as {
      apiSecret?: unknown;
      displayName?: unknown;
    };
    if (!parsed || typeof parsed.apiSecret !== "string") {
      return NextResponse.json(
        { error: "API secret is required" },
        { status: 400 }
      );
    }
    apiSecret = parsed.apiSecret;
    displayName =
      typeof parsed.displayName === "string" ? parsed.displayName : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const isValid = await validateApiSecret(apiSecret.trim());
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid API secret. Could not authenticate with Mudrex." },
        { status: 401 }
      );
    }

    const trimmedSecret = apiSecret.trim();
    const encrypted = encryptApiSecret(trimmedSecret);
    const fingerprint = computeUserSecretFingerprint(trimmedSecret);

    // Legacy fallback: rows created before migration 0009 were keyed by
    // `base64(apiSecret).slice(0, 16)` and have a null fingerprint. Look up
    // the new fingerprint first, then fall back to the legacy id so those
    // users transition on their next login (below we backfill the column).
    const legacyId = Buffer.from(trimmedSecret).toString("base64").slice(0, 16);
    let [existing] = await db
      .select()
      .from(users)
      .where(eq(users.userSecretFingerprint, fingerprint))
      .orderBy(asc(users.createdAt))
      .limit(1);
    if (!existing) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, legacyId));
      if (rows.length > 0) existing = rows[0];
    }

    let userId: string;
    let userName: string;

    if (existing) {
      userId = existing.id;
      const incoming = displayName?.trim();
      userName = incoming || existing.displayName;
      await db
        .update(users)
        .set({
          apiSecretEncrypted: encrypted,
          userSecretFingerprint: fingerprint,
          ...(incoming ? { displayName: incoming } : {}),
        })
        .where(eq(users.id, userId));
    } else {
      userId = uuidv4();
      userName = displayName?.trim() || "Trader";
      await db.insert(users).values({
        id: userId,
        displayName: userName,
        apiSecretEncrypted: encrypted,
        userSecretFingerprint: fingerprint,
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
