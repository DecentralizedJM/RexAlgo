import { NextResponse } from "next/server";
import {
  COOKIE_NAME,
  SESSION_COOKIE_PATH,
  clearLegacySessionCookie,
} from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  clearLegacySessionCookie(response);
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: SESSION_COOKIE_PATH,
  });
  return response;
}
