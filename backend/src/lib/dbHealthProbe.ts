import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const DB_PROBE_TIMEOUT_MS = 500;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export type DbProbeResult = { ok: boolean; latencyMs: number; error?: string };

async function probeDbOnce(): Promise<DbProbeResult> {
  const started = Date.now();
  try {
    await withTimeout(db.execute(sql`select 1`), DB_PROBE_TIMEOUT_MS, "db ping");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

let lastOk: { at: number; result: DbProbeResult } | null = null;
let probeInFlight: Promise<DbProbeResult> | null = null;

/**
 * Used by GET `/api/health`. While the last probe succeeded, reuses that result
 * for `REXALGO_HEALTH_DB_CACHE_MS` (default 2000ms) so thundering herds (LB +
 * k6) do not each open a DB round-trip. Concurrent callers during a probe share
 * one in-flight `select 1`. Failed probes are never cached.
 */
export async function getThrottledHealthDbProbe(): Promise<DbProbeResult> {
  const ttl = Math.max(
    0,
    Number.parseInt(process.env.REXALGO_HEALTH_DB_CACHE_MS ?? "2000", 10)
  );
  const now = Date.now();
  if (ttl > 0 && lastOk && now - lastOk.at < ttl) {
    return lastOk.result;
  }
  if (probeInFlight) return probeInFlight;
  probeInFlight = (async () => {
    try {
      const result = await probeDbOnce();
      if (result.ok) lastOk = { at: Date.now(), result };
      else lastOk = null;
      return result;
    } finally {
      probeInFlight = null;
    }
  })();
  return probeInFlight;
}
