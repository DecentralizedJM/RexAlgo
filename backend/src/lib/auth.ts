/**
 * Session + secret storage: JWT in HttpOnly cookie (`rexalgo_session`), AES-256-GCM for Mudrex secret at rest.
 * Env: JWT_SECRET, ENCRYPTION_KEY (see backend/.env.example).
 * @see README.md#architecture — authentication sequence diagram
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import crypto from "crypto";
import type { AuthUser } from "@/types";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "rexalgo-dev-secret-change-in-production-2024"
);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "rexalgo-enc-key-32chars-changeme!";
const ALGORITHM = "aes-256-gcm";
const COOKIE_NAME = "rexalgo_session";

/** Mudrex rotates API keys on a ~90-day cadence; sessions should not outlive a valid key. */
export const MUDREX_API_KEY_MAX_DAYS = 90;

/**
 * Browser session length (JWT `exp` + cookie `maxAge`). Configurable so trading UIs can stay signed in
 * without daily re-login; cap at {@link MUDREX_API_KEY_MAX_DAYS} so we don’t promise a cookie longer
 * than a single Mudrex key lifetime.
 */
export function getSessionMaxAgeDays(): number {
  const raw = process.env.REXALGO_SESSION_MAX_AGE_DAYS;
  /** Default 90 = same cap as a single Mudrex key lifetime — best for long-running strategy UIs. */
  if (raw === undefined || raw === "") return MUDREX_API_KEY_MAX_DAYS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return MUDREX_API_KEY_MAX_DAYS;
  return Math.min(MUDREX_API_KEY_MAX_DAYS, Math.max(1, n));
}

export function getSessionMaxAgeSeconds(): number {
  return getSessionMaxAgeDays() * 24 * 60 * 60;
}

/** Only sent on `/api/*` so other apps on the same host (e.g. localhost:3001) don’t get this cookie. */
export const SESSION_COOKIE_PATH =
  process.env.REXALGO_SESSION_COOKIE_PATH || "/api";

export function encryptApiSecret(apiSecret: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(apiSecret, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptApiSecret(encrypted: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const [ivHex, authTagHex, data] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export async function createSession(
  userId: string,
  displayName: string,
  apiSecretEncrypted: string
): Promise<string> {
  const days = getSessionMaxAgeDays();
  const token = await new SignJWT({
    userId,
    displayName,
    apiSecretEncrypted,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${days}d`)
    .setIssuedAt()
    .sign(JWT_SECRET);

  return token;
}

export async function verifySession(
  token: string
): Promise<{
  userId: string;
  displayName: string;
  apiSecretEncrypted: string;
  sessionExpiresAt: Date | null;
} | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const exp =
      typeof payload.exp === "number" && Number.isFinite(payload.exp)
        ? new Date(payload.exp * 1000)
        : null;
    return {
      userId: payload.userId as string,
      displayName: payload.displayName as string,
      apiSecretEncrypted: payload.apiSecretEncrypted as string,
      sessionExpiresAt: exp,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<{
  user: AuthUser;
  apiSecret: string;
  sessionExpiresAt: Date | null;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  try {
    const apiSecret = decryptApiSecret(session.apiSecretEncrypted);
    return {
      user: { id: session.userId, displayName: session.displayName },
      apiSecret,
      sessionExpiresAt: session.sessionExpiresAt,
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Clear any legacy session cookie that was set with Path=/ (shared with other localhost apps).
 * Call from login/logout responses so only Path=/api remains.
 */
export function clearLegacySessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

export { COOKIE_NAME };
