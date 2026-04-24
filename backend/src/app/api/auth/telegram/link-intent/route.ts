/**
 * GET /api/auth/telegram/link-intent — returns a short-lived JWT for
 * `POST /api/auth/telegram/start` so “Connect Telegram” links the correct
 * RexAlgo user even when the session cookie is not sent on POST (common
 * with strict browser storage / cross-site quirks behind Vercel → Railway).
 */
import { NextResponse } from "next/server";
import { createTelegramLinkIntentJwt, getSession } from "@/lib/auth";
import { ensureDbReady } from "@/lib/db";

export async function GET() {
  await ensureDbReady();
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const linkToken = await createTelegramLinkIntentJwt(session.user.id);
  const res = NextResponse.json({ linkToken });
  res.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate, max-age=0"
  );
  return res;
}
