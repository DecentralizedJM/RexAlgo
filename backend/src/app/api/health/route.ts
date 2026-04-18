import { NextResponse } from "next/server";
import { ensureDbReady } from "@/lib/db";

/**
 * Dev/prod sanity check: proves this process is RexAlgo’s API (not some other app on :3000).
 * Root `dev:web` waits on this URL before starting Vite.
 *
 * Awaits `ensureDbReady()` so health stays 503-ish if migrations fail (and so
 * `wait-on` does not start Vite before Postgres is migrated when instrumentation
 * ordering differs by Next version).
 */
export async function GET() {
  if (process.env.REXALGO_SKIP_DB_BOOT !== "1") {
    await ensureDbReady();
  }
  return NextResponse.json({ ok: true, service: "rexalgo-api" });
}
