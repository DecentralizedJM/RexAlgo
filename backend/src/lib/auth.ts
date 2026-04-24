/**
 * Session + secret storage: JWT in HttpOnly cookie (`rexalgo_session`), AES-256-GCM for secure Mudrex secret encryption.
 * Env: JWT_SECRET, ENCRYPTION_KEY (see backend/.env.example).
 * @see README.md#architecture (authentication sequence diagram)
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";
import type { AuthUser } from "@/types";
import { sessionJwtIssuedAtAllowed } from "@/lib/sessionPolicy";

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

/**
 * `Domain` for `Set-Cookie` when the API is behind a reverse proxy (e.g. Vercel
 * → Railway). Without this, the cookie can be scoped to the upstream host so the
 * browser on your public domain never stores `rexalgo_session` for `/api/*`.
 *
 * Set `REXALGO_SESSION_COOKIE_DOMAIN` (with or without leading `.`), or we derive
 * from `PUBLIC_APP_URL` when it is your SPA origin (skipped for localhost).
 */
export function sessionCookieDomainFromEnv(): string | undefined {
  const raw = process.env.REXALGO_SESSION_COOKIE_DOMAIN?.trim();
  if (raw) {
    const host = raw.replace(/^\./, "");
    if (!host || host === "localhost" || host.startsWith("127.")) return undefined;
    return `.${host}`;
  }
  const app = process.env.PUBLIC_APP_URL?.trim();
  if (!app) return undefined;
  try {
    const hostname = new URL(
      /^https?:\/\//i.test(app) ? app : `https://${app}`
    ).hostname;
    if (!hostname || hostname === "localhost" || hostname.startsWith("127.")) {
      return undefined;
    }
    return `.${hostname.replace(/^\./, "")}`;
  } catch {
    return undefined;
  }
}

/** Standard options for setting the session JWT cookie on API responses. */
export function sessionCookieWriteOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
  domain?: string;
} {
  const domain = sessionCookieDomainFromEnv();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: getSessionMaxAgeSeconds(),
    path: SESSION_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  };
}

function sessionCookieClearOptions(path: string): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
  domain?: string;
} {
  const domain = sessionCookieDomainFromEnv();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path,
    ...(domain ? { domain } : {}),
  };
}

/** Max-age=0 without `Domain` — clears host-only cookies from before Domain was set. */
function sessionCookieClearHostOnlyOptions(path: string): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path,
  };
}

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
  apiSecretEncrypted: string | null,
  email: string | null
): Promise<string> {
  const days = getSessionMaxAgeDays();
  const token = await new SignJWT({
    userId,
    displayName,
    apiSecretEncrypted: apiSecretEncrypted ?? undefined,
    email: email ?? undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${days}d`)
    .setIssuedAt()
    .sign(JWT_SECRET);

  return token;
}

const TELEGRAM_LINK_JWT_PURPOSE = "telegram_link_v1";
const TELEGRAM_LINK_JWT_MAX_SEC = 15 * 60;

/**
 * Short-lived JWT proving which RexAlgo user is connecting Telegram. Sent in
 * `POST /api/auth/telegram/start` as `linkToken` so linking works even when the
 * browser does not attach the session cookie on POST (Safari / partitioned
 * storage / some proxy setups) — GET `/api/auth/telegram/link-intent` still
 * receives the cookie and returns this token.
 */
export async function createTelegramLinkIntentJwt(userId: string): Promise<string> {
  return new SignJWT({ purpose: TELEGRAM_LINK_JWT_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime(`${TELEGRAM_LINK_JWT_MAX_SEC}s`)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

/** Returns RexAlgo `userId` or `null` if invalid / expired / wrong purpose. */
export async function verifyTelegramLinkIntentJwt(
  token: string
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (payload.purpose !== TELEGRAM_LINK_JWT_PURPOSE) return null;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    return sub && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

export async function verifySession(
  token: string
): Promise<{
  userId: string;
  displayName: string;
  apiSecretEncrypted: string | null;
  email: string | null;
  sessionExpiresAt: Date | null;
} | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!sessionJwtIssuedAtAllowed(payload.iat)) return null;
    const exp =
      typeof payload.exp === "number" && Number.isFinite(payload.exp)
        ? new Date(payload.exp * 1000)
        : null;
    return {
      userId: payload.userId as string,
      displayName: payload.displayName as string,
      apiSecretEncrypted:
        typeof payload.apiSecretEncrypted === "string"
          ? payload.apiSecretEncrypted
          : null,
      email:
        typeof payload.email === "string" ? payload.email : null,
      sessionExpiresAt: exp,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<{
  user: AuthUser;
  apiSecret: string | null;
  sessionExpiresAt: Date | null;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySession(token);
  if (!session) return null;

  let apiSecret: string | null = null;
  if (session.apiSecretEncrypted) {
    try {
      apiSecret = decryptApiSecret(session.apiSecretEncrypted);
    } catch {
      /* key may be corrupt — session is still valid, just without Mudrex access */
    }
  }

  return {
    user: {
      id: session.userId,
      displayName: session.displayName,
      email: session.email,
    },
    apiSecret,
    sessionExpiresAt: session.sessionExpiresAt,
  };
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/** Like getSession() but returns 403 JSON if no Mudrex API key is linked. */
export async function requireMudrexSession(): Promise<
  | { user: AuthUser; apiSecret: string; sessionExpiresAt: Date | null }
  | { error: true; response: ReturnType<typeof NextResponse.json> }
> {
  const session = await getSession();
  if (!session) {
    return {
      error: true,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!session.apiSecret) {
    return {
      error: true,
      response: NextResponse.json(
        { error: "Link your Mudrex API key first", code: "MUDREX_KEY_REQUIRED" },
        { status: 403 }
      ),
    };
  }
  return {
    user: session.user,
    apiSecret: session.apiSecret,
    sessionExpiresAt: session.sessionExpiresAt,
  };
}

/**
 * Aggressively clear any session cookies that might exist for this app.
 *
 * Over time we have used different cookie paths (e.g. "/", "/api"); if more than one
 * `rexalgo_session` cookie is present for the same domain, the server may read a
 * different one than the browser UI expects. To avoid "sticky" or cross-user sessions,
 * always call this before setting a new cookie and from logout handlers.
 *
 * When `Domain=.rexalgo.xyz` (or similar) is used, also emit host-only clears
 * (`Set-Cookie` without `Domain`) so cookies created **before** Domain was
 * deployed are removed — otherwise logout appears broken while an old cookie
 * keeps the session alive.
 */
export function clearAllSessionCookies(response: NextResponse) {
  const paths = new Set<string>(["/", SESSION_COOKIE_PATH, "/api"]);
  const domain = sessionCookieDomainFromEnv();
  for (const path of paths) {
    response.cookies.set(COOKIE_NAME, "", sessionCookieClearOptions(path));
    if (domain) {
      response.cookies.set(COOKIE_NAME, "", sessionCookieClearHostOnlyOptions(path));
    }
  }
}

export { COOKIE_NAME };
