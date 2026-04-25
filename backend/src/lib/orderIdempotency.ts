/**
 * POST /api/mudrex/orders idempotency: replay the same JSON within ~60s when
 * `Idempotency-Key` is sent (Redis when configured, else in-memory per process).
 */
import crypto from "crypto";
import { getRedis } from "@/lib/redis";

const TTL_SEC = 60;
const REDIS_PREFIX = "rexalgo:idem:mudrex_order:";
const mem = new Map<string, { record: IdempotencyRecord; expiresAt: number }>();

type IdempotencyRecord = {
  requestHash: string;
  responseJson: string;
};

export type IdempotencyLookup =
  | { status: "miss" }
  | { status: "hit"; responseJson: string }
  | { status: "conflict" };

function cacheKey(userId: string, idempotencyKey: string): string {
  const h = crypto
    .createHash("sha256")
    .update(`${userId}\0${idempotencyKey}`, "utf8")
    .digest("hex");
  return `${REDIS_PREFIX}${h}`;
}

function pruneMem(): void {
  const now = Date.now();
  for (const [k, v] of mem) {
    if (v.expiresAt <= now) mem.delete(k);
  }
}

function parseRecord(raw: string | null): IdempotencyRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<IdempotencyRecord>;
    if (
      typeof parsed.requestHash === "string" &&
      typeof parsed.responseJson === "string"
    ) {
      return {
        requestHash: parsed.requestHash,
        responseJson: parsed.responseJson,
      };
    }
  } catch {
    // Legacy cache value from before request hashing; ignore rather than replay
    // a response whose request body we cannot verify.
  }
  return null;
}

export async function getMudrexOrderIdempotentResponse(
  userId: string,
  idempotencyKey: string,
  requestHash: string
): Promise<IdempotencyLookup> {
  const key = cacheKey(userId, idempotencyKey);
  const redis = getRedis();
  if (redis) {
    try {
      const record = parseRecord(await redis.get(key));
      if (!record) return { status: "miss" };
      if (record.requestHash !== requestHash) return { status: "conflict" };
      return { status: "hit", responseJson: record.responseJson };
    } catch {
      return { status: "miss" };
    }
  }
  pruneMem();
  const hit = mem.get(key);
  if (!hit || hit.expiresAt <= Date.now()) {
    if (hit) mem.delete(key);
    return { status: "miss" };
  }
  if (hit.record.requestHash !== requestHash) return { status: "conflict" };
  return { status: "hit", responseJson: hit.record.responseJson };
}

export async function setMudrexOrderIdempotentResponse(
  userId: string,
  idempotencyKey: string,
  requestHash: string,
  jsonBody: string
): Promise<void> {
  const key = cacheKey(userId, idempotencyKey);
  const record: IdempotencyRecord = { requestHash, responseJson: jsonBody };
  const encoded = JSON.stringify(record);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, encoded, "EX", TTL_SEC);
    } catch {
      /* best-effort */
    }
    return;
  }
  mem.set(key, { record, expiresAt: Date.now() + TTL_SEC * 1000 });
}
