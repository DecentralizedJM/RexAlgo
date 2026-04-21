import { NextResponse } from "next/server";
import { clearAllSessionCookies } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  // Belt-and-suspenders: wipe all known cookie paths so no stale session can survive.
  clearAllSessionCookies(response);
  return response;
}
