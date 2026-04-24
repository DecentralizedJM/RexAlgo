import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  clearAllSessionCookies,
  revokeSessionById,
  verifySessionCookie,
} from "@/lib/auth";

export async function POST() {
  // Read the cookie before clearing it so we can mark the row revoked. If the
  // cookie is missing/invalid we still clear client-side state — logout is
  // idempotent.
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    const verified = await verifySessionCookie(token);
    if (verified) {
      try {
        await revokeSessionById(verified.sid);
      } catch {
        /* best-effort — cookie clearing below still signs the browser out */
      }
    }
  }

  const response = NextResponse.json({ success: true });
  clearAllSessionCookies(response);
  return response;
}
