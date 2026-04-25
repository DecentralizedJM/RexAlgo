import { NextResponse } from "next/server";
import { ensureDbReady } from "@/lib/db";
import { getThrottledHealthDbProbe } from "@/lib/dbHealthProbe";

/**
 * Public liveness probe. Detailed dependency and queue state lives at
 * `/api/ready` (optionally protected by `REXALGO_READY_TOKEN`) to avoid leaking
 * operational internals on a public endpoint.
 *
 * DB reachability is probed with throttling (`REXALGO_HEALTH_DB_CACHE_MS`, default
 * 2000ms) so load balancers and load tests do not stampede the connection pool.
 */

export async function GET() {
  if (process.env.REXALGO_SKIP_DB_BOOT !== "1") {
    await ensureDbReady();
  }

  const dbRes = await getThrottledHealthDbProbe();

  const body = {
    ok: dbRes.ok,
    service: "rexalgo-api",
  };

  return NextResponse.json(body, { status: dbRes.ok ? 200 : 503 });
}
