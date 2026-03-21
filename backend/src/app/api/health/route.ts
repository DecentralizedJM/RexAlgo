import { NextResponse } from "next/server";

/**
 * Dev/prod sanity check: proves this process is RexAlgo’s API (not some other app on :3000).
 * Root `dev:web` waits on this URL before starting Vite.
 */
export async function GET() {
  return NextResponse.json({ ok: true, service: "rexalgo-api" });
}
