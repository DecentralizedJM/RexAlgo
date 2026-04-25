import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, ensureDbReady } from "@/lib/db";
import { notificationsOutbox } from "@/lib/schema";
import { getRedis } from "@/lib/redis";

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
  processing: number;
  failed24h: number;
  oldestQueuedAgeSec: number | null;
}> {
  try {
    const rows = (await db.execute(sql`
      select
        count(*) filter (where ${notificationsOutbox.status} = 'queued')::int as queued,
        count(*) filter (where ${notificationsOutbox.status} = 'processing')::int as processing,
        count(*) filter (
          where ${notificationsOutbox.status} = 'failed'
            and ${notificationsOutbox.createdAt} > now() - interval '24 hours'
        )::int as failed_24h,
        extract(epoch from (now() - min(${notificationsOutbox.createdAt}))) filter (
          where ${notificationsOutbox.status} = 'queued'
        )::int as oldest_queued_age_sec
      from ${notificationsOutbox}
    `)) as unknown as {
      rows: Array<{
        queued: number;
        processing: number;
        failed_24h: number;
        oldest_queued_age_sec: number | null;
      }>;
    };
    const r = rows.rows?.[0];
    return {
      queued: Number(r?.queued ?? 0),
      processing: Number(r?.processing ?? 0),
      failed24h: Number(r?.failed_24h ?? 0),
      oldestQueuedAgeSec: r?.oldest_queued_age_sec ?? null,
    };
  } catch {
    return { queued: 0, processing: 0, failed24h: 0, oldestQueuedAgeSec: null };
  }
}

function authorized(req: NextRequest): boolean {
  const token = process.env.REXALGO_READY_TOKEN?.trim();
  if (!token) return true;
  return req.headers.get("authorization") === `Bearer ${token}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.REXALGO_SKIP_DB_BOOT !== "1") {
    await ensureDbReady();
  }

  const [dbRes, redisRes] = await Promise.all([probeDb(), probeRedis()]);
  const notifications = dbRes.ok
    ? await probeNotifications()
    : { queued: 0, processing: 0, failed24h: 0, oldestQueuedAgeSec: null };

  const warnings: string[] = [];
  if (redisRes.status === "error") warnings.push(`redis: ${redisRes.error}`);
  if (
    process.env.REXALGO_SCALE_MODE === "multi_instance" &&
    redisRes.status !== "ok"
  ) {
    warnings.push("redis_required_for_multi_instance");
  }

  const ok =
    dbRes.ok &&
    !(
      process.env.REXALGO_SCALE_MODE === "multi_instance" &&
      redisRes.status !== "ok"
    );

  return NextResponse.json(
    {
      ok,
      service: "rexalgo-api",
      db: dbRes,
      redis: redisRes,
      notifications,
      warnings,
    },
    { status: ok ? 200 : 503 }
  );
}
