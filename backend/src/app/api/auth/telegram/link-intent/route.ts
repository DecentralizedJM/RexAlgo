/**
 * GET /api/auth/telegram/link-intent — returns a short-lived JWT for
 * `POST /api/auth/telegram/start` so “Connect Telegram” links the correct
 * RexAlgo user even when the session cookie is not sent on POST (common
 * with strict browser storage / cross-site quirks behind Vercel → Railway).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createTelegramLinkIntentJwt, getSession } from "@/lib/auth";
import { db, ensureDbReady } from "@/lib/db";
import { users } from "@/lib/schema";

export async function GET() {
  await ensureDbReady();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Session JWT is stateless — after DB reset or user deletion the cookie can
  // still verify while `users` no longer has this id (FK error on token insert).
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, session.user.id));
  if (!row) {
    return NextResponse.json(
      {
        error:
          "Your session no longer matches an account in our database. Sign out and sign in with Google again.",
        code: "SESSION_USER_MISSING",
      },
      { status: 401 }
    );
  }
  const linkToken = await createTelegramLinkIntentJwt(session.user.id);
  const res = NextResponse.json({ linkToken });
  res.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate, max-age=0"
  );
  return res;
}
