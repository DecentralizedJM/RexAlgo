/**
 * Server-backed browser sessions + AES-256-GCM secret storage.
 *
 * A session is a row in `user_sessions`; the HttpOnly `rexalgo_session` cookie
 * carries a signed JWS whose only meaningful claim is `sid`. Every request
 * looks up the row so per-device logout and admin revoke are a one-row update
 * rather than a global `JWT_SECRET` / `REXALGO_SESSION_MIN_IAT` rotation.
 *
 * Legacy sessions (pre–user_sessions rollout) had `userId` / `apiSecretEncrypted`
 * embedded directly in the JWT. Those cookies are rejected on the next request
 * because they lack `sid`, and users sign in again — which writes a row the
 * new code path understands. `REXALGO_SESSION_MIN_IAT` is still honoured so
 * operators can fast-forward that cutover without deploying new code.
 *
 * Env: JWT_SECRET, ENCRYPTION_KEY (see backend/.env.example).
 * @see backend/src/lib/schema.ts (`userSessions`)
 * @see README.md#architecture (authentication sequence diagram)
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, isNull, lte } from "drizzle-orm";
import crypto from "crypto";
import type { AuthUser } from "@/types";
import { sessionJwtIssuedAtAllowed } from "@/lib/sessionPolicy";
import { requireSecretEnv } from "@/lib/requireEnv";
import { db } from "@/lib/db";
import { userSessions, users } from "@/lib/schema";

/**
 * Fail-fast on missing secrets so a production deploy cannot silently boot
 * with the public-repo default fallback. See {@link requireSecretEnv} for the
 * exact behaviour (throws at first access, tolerates dev without a .env when
 * `REXALGO_ALLOW_DEV_SECRETS=1`).
 */
const JWT_SECRET = new TextEncoder().encode(requireSecretEnv("JWT_SECRET"));

const ENCRYPTION_KEY = requireSecretEnv("ENCRYPTION_KEY");
const ALGORITHM = "aes-256-gcm";
const COOKIE_NAME = "rexalgo_session";

/** Mudrex rotates API keys on a ~90-day cadence; sessions should not outlive a valid key. */
export const MUDREX_API_KEY_MAX_DAYS = 90;

/**
 * Browser session length (JWS `exp` + cookie `maxAge` + `user_sessions.expires_at`).
 * Configurable so trading UIs can stay signed in without daily re-login; cap at
 * {@link MUDREX_API_KEY_MAX_DAYS} so we don't promise a cookie longer than a
 * single Mudrex key lifetime.
 */
export function getSessionMaxAgeDays(): number {
  const raw = process.env.REXALGO_SESSION_MAX_AGE_DAYS;
  if (raw === undefined || raw === "") return MUDREX_API_KEY_MAX_DAYS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return MUDREX_API_KEY_MAX_DAYS;
  return Math.min(MUDREX_API_KEY_MAX_DAYS, Math.max(1, n));
}

export function getSessionMaxAgeSeconds(): number {
  return getSessionMaxAgeDays() * 24 * 60 * 60;
}

/** Only sent on `/api/*` so other apps on the same host (e.g. localhost:3001) don't get this cookie. */
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

type SameSitePolicy = "lax" | "strict" | "none";

/**
 * Session cookie SameSite policy.
 *
 * Default is `strict`: the browser will not attach the cookie on any
 * cross-site navigation, which eliminates the low-grade CSRF risk that
 * `lax` leaves open (a GET-able mutation handler would be CSRF-able from
 * any site under `lax`). All our API traffic is XHR/`fetch()` from our own
 * SPA, so `strict` is safe.
 *
 * OAuth & Telegram login flows never re-use the existing session cookie
 * across the provider bounce — they mint a brand-new cookie on the final
 * callback which the browser is happy to accept regardless of SameSite.
 *
 * Operators can downgrade to `lax` for a deploy via
 * `REXALGO_SESSION_SAMESITE=lax` if a CSRF-hostile flow surfaces during
 * smoke tests. `none` requires `Secure=true` (enforced below via
 * `NODE_ENV=production`).
 */
function sessionCookieSameSite(): SameSitePolicy {
  const raw = process.env.REXALGO_SESSION_SAMESITE?.trim().toLowerCase();
  if (raw === "lax" || raw === "none") return raw;
  return "strict";
}

/** Standard options for setting the session cookie on API responses. */
export function sessionCookieWriteOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSitePolicy;
  maxAge: number;
  path: string;
  domain?: string;
} {
  const domain = sessionCookieDomainFromEnv();
  const sameSite = sessionCookieSameSite();
  return {
    httpOnly: true,
    // SameSite=None requires Secure even in dev; keep production behaviour
    // unchanged and only force `secure` when the policy demands it.
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    maxAge: getSessionMaxAgeSeconds(),
    path: SESSION_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  };
}

function sessionCookieClearOptions(path: string): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSitePolicy;
  maxAge: number;
  path: string;
  domain?: string;
} {
  const domain = sessionCookieDomainFromEnv();
  const sameSite = sessionCookieSameSite();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    maxAge: 0,
    path,
    ...(domain ? { domain } : {}),
  };
}

/** Max-age=0 without `Domain` — clears host-only cookies from before Domain was set. */
function sessionCookieClearHostOnlyOptions(path: string): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSitePolicy;
  maxAge: number;
  path: string;
} {
  const sameSite = sessionCookieSameSite();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    maxAge: 0,
    path,
  };
}

/**
 * AES-256-GCM at-rest encryption for third-party API secrets.
 *
 * Stored format has two versions:
 *   v1 (legacy):  `<iv_hex>:<tag_hex>:<cipher_hex>` — key derived with the
 *                 hardcoded salt `"salt"`. Every row shares the same derived
 *                 key; one leaked `ENCRYPTION_KEY` decrypts every row.
 *   v2 (current): `v2:<salt_hex>:<iv_hex>:<tag_hex>:<cipher_hex>` — fresh
 *                 16-byte random salt per row, so each ciphertext has its own
 *                 derived key. Requires the same `ENCRYPTION_KEY` master to
 *                 decrypt, but eliminates the bulk-leak amplification.
 *
 * `encryptApiSecret` always writes v2. `decryptApiSecret` reads both; every
 * authenticated write path (login / link-mudrex / TV-webhook create & rotate
 * / copy-webhook create & rotate) re-encrypts when rewriting the column, so
 * the legacy v1 rows fade as users sign back in.
 */
const ENC_V2 = "v2";
const V2_SALT_BYTES = 16;

function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(ENCRYPTION_KEY, salt, 32);
}

export function encryptApiSecret(apiSecret: string): string {
  const salt = crypto.randomBytes(V2_SALT_BYTES);
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(apiSecret, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${ENC_V2}:${salt.toString("hex")}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptApiSecret(encrypted: string): string {
  const parts = encrypted.split(":");

  if (parts[0] === ENC_V2 && parts.length === 5) {
    const [, saltHex, ivHex, authTagHex, data] = parts;
    const salt = Buffer.from(saltHex, "hex");
    const key = deriveKey(salt);
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // Legacy v1 format: `<iv>:<tag>:<cipher>` with hardcoded "salt" literal.
  // Kept so existing rows continue to work until their next write.
  if (parts.length === 3) {
    const [ivHex, authTagHex, data] = parts;
    const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  throw new Error("Unrecognised ciphertext format");
}

/** True when the stored ciphertext uses the legacy v1 single-salt format. */
export function isLegacyEncryptedSecret(encrypted: string): boolean {
  const parts = encrypted.split(":");
  return parts.length === 3 && parts[0] !== ENC_V2;
}

export interface CreateSessionOptions {
  userAgent?: string | null;
  authProvider?: string | null;
}

/**
 * Create a new `user_sessions` row and return the signed cookie value that
 * references it. Callers should set this on the response via
 * `sessionCookieWriteOptions()`.
 *
 * The cookie is a JWS (not a JWT): the only payload claim is `sid`; `exp` and
 * `iat` are protected-header standard claims. Keeping claims minimal means
 * rotating a user's display name / Mudrex link does not invalidate the cookie.
 */
export async function createSession(
  userId: string,
  opts: CreateSessionOptions = {}
): Promise<string> {
  const days = getSessionMaxAgeDays();
  const sid = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  await db.insert(userSessions).values({
    id: sid,
    userId,
    userAgent: opts.userAgent?.slice(0, 512) ?? null,
    authProvider: opts.authProvider ?? "unknown",
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });

  return new SignJWT({ sid })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${days}d`)
    .setIssuedAt()
    .sign(JWT_SECRET);
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

/** Low-level: verify the cookie and extract the session id (no DB hit). */
export async function verifySessionCookie(
  token: string
): Promise<{ sid: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!sessionJwtIssuedAtAllowed(payload.iat)) return null;
    const sid = typeof payload.sid === "string" ? payload.sid : null;
    if (!sid) return null;
    return { sid };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<{
  user: AuthUser;
  apiSecret: string | null;
  sessionId: string;
  sessionCreatedAt: Date;
  sessionExpiresAt: Date | null;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const verified = await verifySessionCookie(token);
  if (!verified) return null;

  const [row] = await db
    .select({
      id: userSessions.id,
      userId: userSessions.userId,
      createdAt: userSessions.createdAt,
      expiresAt: userSessions.expiresAt,
      revokedAt: userSessions.revokedAt,
      displayName: users.displayName,
      email: users.email,
      apiSecretEncrypted: users.apiSecretEncrypted,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(eq(userSessions.id, verified.sid));

  if (!row) return null;
  if (row.revokedAt) return null;
  // Allow a 1-second grace window at the expiry boundary. Without it, a
  // session that JUST expired (by a handful of ms) fails here even though
  // the JWT `exp` check upstream in middleware still passed — the client
  // then sees a confusing "logged out mid-request". JWT `exp` is only
  // second-granular anyway, so a sub-second mismatch is a pure race.
  if (row.expiresAt.getTime() < Date.now() - 1000) return null;

  let apiSecret: string | null = null;
  if (row.apiSecretEncrypted) {
    try {
      apiSecret = decryptApiSecret(row.apiSecretEncrypted);
    } catch {
      /* key may be corrupt — session is still valid, just without Mudrex access */
    }
  }

  return {
    user: {
      id: row.userId,
      displayName: row.displayName,
      email: row.email ?? null,
    },
    apiSecret,
    sessionId: row.id,
    sessionCreatedAt: row.createdAt,
    sessionExpiresAt: row.expiresAt,
  };
}

export function requireRecentSession(
  session: { sessionCreatedAt: Date },
  maxAgeMs = 15 * 60 * 1000
): NextResponse | null {
  if (Date.now() - session.sessionCreatedAt.getTime() <= maxAgeMs) return null;
  return NextResponse.json(
    {
      error: "Please sign in again to confirm this sensitive webhook action.",
      code: "RECENT_LOGIN_REQUIRED",
    },
    { status: 403 }
  );
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

/** Marks a single session revoked — used by `/api/auth/logout`. */
export async function revokeSessionById(sid: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, sid), isNull(userSessions.revokedAt)));
}

/** Marks every active session for `userId` revoked. Admin + "log out everywhere". */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt))
    );
}

/** Opportunistic cleanup: delete rows whose `expires_at` is in the past. */
export async function purgeExpiredSessions(): Promise<number> {
  const res = await db
    .delete(userSessions)
    .where(lte(userSessions.expiresAt, new Date()));
  return res.rowCount ?? 0;
}

export { COOKIE_NAME };
