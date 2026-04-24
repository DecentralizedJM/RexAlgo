import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, ensureDbReady } from "@/lib/db";
import { notificationsOutbox } from "@/lib/schema";
import { getRedis } from "@/lib/redis";

/**
 * Liveness + shallow dependency probe.
 *
 * Used by:
 *   - Dev orchestration (`wait-on` in the root `dev:web` script) to know when
 *     the API has booted before starting Vite.
 *   - Docker / Railway health checks (see `backend/Dockerfile` HEALTHCHECK).
 *   - Ops dashboards (so humans can sanity-check a deploy).
 *
 * Probes:
 *   - Postgres: `SELECT 1` with a 500ms timeout. Failure → 503. This is the
 *     load-bearing dependency: if the DB is gone, the API cannot serve
 *     anything useful, so we fail loud.
 *   - Redis (if `REDIS_URL` is set): `PING`. Failure is surfaced as a
 *     `warnings` entry but the overall response stays 200 — Redis is an
 *     optimisation (shared rate-limit buckets) and the in-memory fallback
 *     means the API stays green during a brief Redis blip.
 *   - Notifications outbox: queued + failed counts + oldest queued age, so an
 *     operator can spot a stuck worker or a dead Telegram channel without
 *     shelling into the DB.
 *
 * The outer shape stays backward-compatible: consumers that only check for
 * `{ ok: true, service: "rexalgo-api" }` continue to work.
 */
const DB_PROBE_TIMEOUT_MS = 500;
const REDIS_PROBE_TIMEOUT_MS = 500;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function probeDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
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

async function probeRedis(): Promise<
  | { status: "disabled" }
  | { status: "ok"; latencyMs: number }
  | { status: "error"; latencyMs: number; error: string }
> {
  const redis = getRedis();
  if (!redis) return { status: "disabled" };
  const started = Date.now();
  try {
    await withTimeout(redis.ping(), REDIS_PROBE_TIMEOUT_MS, "redis ping");
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeNotifications(): Promise<{
  queued: number;
  failed24h: number;
  oldestQueuedAgeSec: number | null;
}> {
  try {
    const rows = (await db.execute(sql`
      select
        count(*) filter (where ${notificationsOutbox.status} = 'queued')::int as queued,
        count(*) filter (
          where ${notificationsOutbox.status} = 'failed'
            and ${notificationsOutbox.createdAt} > now() - interval '24 hours'
        )::int as failed_24h,
        extract(epoch from (now() - min(${notificationsOutbox.createdAt}))) filter (
          where ${notificationsOutbox.status} = 'queued'
        )::int as oldest_queued_age_sec
      from ${notificationsOutbox}
    `)) as unknown as {
      rows: Array<{ queued: number; failed_24h: number; oldest_queued_age_sec: number | null }>;
    };
    const r = rows.rows?.[0];
    return {
      queued: Number(r?.queued ?? 0),
      failed24h: Number(r?.failed_24h ?? 0),
      oldestQueuedAgeSec: r?.oldest_queued_age_sec ?? null,
    };
  } catch {
    return { queued: 0, failed24h: 0, oldestQueuedAgeSec: null };
  }
}

export async function GET() {
  if (process.env.REXALGO_SKIP_DB_BOOT !== "1") {
    await ensureDbReady();
  }

  const [dbRes, redisRes] = await Promise.all([probeDb(), probeRedis()]);
  const notifications = dbRes.ok
    ? await probeNotifications()
    : { queued: 0, failed24h: 0, oldestQueuedAgeSec: null };

  const warnings: string[] = [];
  if (redisRes.status === "error") {
    warnings.push(`redis: ${redisRes.error}`);
  }

  const body = {
    ok: dbRes.ok,
    service: "rexalgo-api",
    db: dbRes,
    redis: redisRes,
    notifications,
    warnings,
  };

  return NextResponse.json(body, { status: dbRes.ok ? 200 : 503 });
}
