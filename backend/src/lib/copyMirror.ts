/**
 * Parse copy-trading webhook payloads and mirror orders to subscribers via Mudrex.
 */
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  strategies,
  subscriptions,
  users,
  copyMirrorAttempts,
} from "@/lib/schema";
import type { InferSelectModel } from "drizzle-orm";
import { decryptApiSecret } from "@/lib/auth";
import {
  createOrder,
  listOpenPositions,
  closePosition,
  getAsset,
  setLeverage,
} from "@/lib/mudrex";

export type CopySignalV1 = {
  idempotency_key: string;
  action: "open" | "close";
  symbol: string;
  side: "LONG" | "SHORT";
  trigger_type: "MARKET" | "LIMIT";
  price?: string;
};

export type StrategyRow = InferSelectModel<typeof strategies>;

export function parseCopySignalV1(json: unknown):
  | { ok: true; signal: CopySignalV1 }
  | { ok: false; reason: string } {
  if (!json || typeof json !== "object") {
    return { ok: false, reason: "Body must be a JSON object" };
  }
  const o = json as Record<string, unknown>;
  const idempotency_key =
    typeof o.idempotency_key === "string" ? o.idempotency_key.trim() : "";
  const action = o.action;
  const symbol = typeof o.symbol === "string" ? o.symbol.trim().toUpperCase() : "";
  const side = o.side;
  const trigger_type = o.trigger_type;
  const price = o.price != null ? String(o.price).trim() : undefined;

  if (!idempotency_key) {
    return { ok: false, reason: "idempotency_key is required" };
  }
  if (action !== "open" && action !== "close") {
    return { ok: false, reason: "action must be open or close" };
  }
  if (!/^[A-Z0-9]{4,32}$/.test(symbol)) {
    return { ok: false, reason: "Invalid symbol" };
  }
  if (side !== "LONG" && side !== "SHORT") {
    return { ok: false, reason: "side must be LONG or SHORT" };
  }
  if (trigger_type !== "MARKET" && trigger_type !== "LIMIT") {
    return { ok: false, reason: "trigger_type must be MARKET or LIMIT" };
  }
  if (trigger_type === "LIMIT" && (!price || parseFloat(price) <= 0)) {
    return { ok: false, reason: "price required for LIMIT orders" };
  }

  return {
    ok: true,
    signal: {
      idempotency_key,
      action,
      symbol,
      side,
      trigger_type,
      price: trigger_type === "LIMIT" ? price : undefined,
    },
  };
}

/** Round quantity to exchange step and min contract size. */
export function computeFollowerQuantity(
  marginUsdt: number,
  leverage: number,
  markPrice: number,
  minQty: number,
  step: number
): number {
  if (markPrice <= 0 || !Number.isFinite(markPrice)) return 0;
  if (marginUsdt <= 0 || leverage <= 0 || !Number.isFinite(marginUsdt)) return 0;
  if (step <= 0 || minQty < 0 || !Number.isFinite(step)) return 0;

  const notional = marginUsdt * leverage;
  const raw = notional / markPrice;
  if (!Number.isFinite(raw) || raw <= 0) return 0;

  const steps = Math.floor(raw / step);
  let q = steps * step;
  if (q < minQty) {
    const minSteps = Math.ceil(minQty / step);
    q = minSteps * step;
  }
  return q;
}

async function mirrorOpen(
  strategy: StrategyRow,
  signal: CopySignalV1,
  apiSecret: string,
  marginPerTrade: string
): Promise<{ ok: true; orderId: string } | { ok: false; detail: string }> {
  const margin = parseFloat(marginPerTrade);
  const lev = parseFloat(strategy.leverage || "1");
  if (!Number.isFinite(margin) || margin <= 0) {
    return { ok: false, detail: "Invalid subscriber margin_per_trade" };
  }
  if (!Number.isFinite(lev) || lev <= 0) {
    return { ok: false, detail: "Invalid strategy leverage" };
  }

  let asset;
  try {
    asset = await getAsset(apiSecret, signal.symbol);
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "Failed to fetch asset",
    };
  }

  const mark = parseFloat(asset.price || "0");
  if (!Number.isFinite(mark) || mark <= 0) {
    return { ok: false, detail: "Asset mark price unavailable" };
  }

  const minQty = parseFloat(asset.min_quantity || "0");
  const step = parseFloat(asset.quantity_step || "0.001");
  const qty = computeFollowerQuantity(margin, lev, mark, minQty, step);
  if (qty <= 0) {
    return {
      ok: false,
      detail: "Computed quantity below minimum — increase margin or check contract specs",
    };
  }

  try {
    await setLeverage(apiSecret, signal.symbol, String(lev), "ISOLATED");
  } catch {
    /* best-effort; exchange may already be set */
  }

  try {
    const order = await createOrder(apiSecret, {
      symbol: signal.symbol,
      side: signal.side,
      quantity: String(qty),
      leverage: String(lev),
      triggerType: signal.trigger_type,
      price: signal.trigger_type === "LIMIT" ? signal.price : undefined,
    });
    return { ok: true, orderId: order.order_id };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "createOrder failed",
    };
  }
}

async function mirrorClose(
  signal: CopySignalV1,
  apiSecret: string
): Promise<{ ok: true; orderId: string } | { ok: false; detail: string }> {
  try {
    const open = await listOpenPositions(apiSecret);
    const matching = open.filter(
      (p) => p.symbol === signal.symbol && p.side === signal.side
    );
    if (matching.length === 0) {
      return { ok: false, detail: "No open position for symbol/side" };
    }
    const last = matching[matching.length - 1];
    const ok = await closePosition(apiSecret, last.position_id);
    if (!ok) {
      return { ok: false, detail: "closePosition returned false" };
    }
    return { ok: true, orderId: last.position_id };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "close failed",
    };
  }
}

export type MirrorSummary = {
  processed: number;
  ok: number;
  errors: number;
};

/**
 * Execute a validated signal for all active subscribers (excluding the strategy creator).
 */
export async function executeMirror(
  strategy: StrategyRow,
  signal: CopySignalV1,
  signalEventId: string
): Promise<MirrorSummary> {
  const subs = await db
    .select({
      userId: subscriptions.userId,
      marginPerTrade: subscriptions.marginPerTrade,
      apiSecretEncrypted: users.apiSecretEncrypted,
    })
    .from(subscriptions)
    .innerJoin(users, eq(subscriptions.userId, users.id))
    .where(
      and(
        eq(subscriptions.strategyId, strategy.id),
        eq(subscriptions.isActive, true)
      )
    );

  let ok = 0;
  let errors = 0;

  for (const sub of subs) {
    if (sub.userId === strategy.creatorId) continue;

    if (!sub.apiSecretEncrypted) {
      await db.insert(copyMirrorAttempts).values({
        id: uuidv4(),
        signalId: signalEventId,
        userId: sub.userId,
        status: "error",
        detail: "Subscriber has no Mudrex API key linked",
      });
      errors++;
      continue;
    }

    let apiSecret: string;
    try {
      apiSecret = decryptApiSecret(sub.apiSecretEncrypted);
    } catch {
      await db.insert(copyMirrorAttempts).values({
        id: uuidv4(),
        signalId: signalEventId,
        userId: sub.userId,
        status: "error",
        detail: "Failed to decrypt subscriber API credentials",
      });
      errors++;
      continue;
    }

    const result =
      signal.action === "open"
        ? await mirrorOpen(strategy, signal, apiSecret, sub.marginPerTrade)
        : await mirrorClose(signal, apiSecret);

    if (result.ok) {
      await db.insert(copyMirrorAttempts).values({
        id: uuidv4(),
        signalId: signalEventId,
        userId: sub.userId,
        status: "ok",
        detail: signal.action === "open" ? "Order placed" : "Position closed",
        mudrexOrderId: result.orderId,
      });
      ok++;
    } else {
      await db.insert(copyMirrorAttempts).values({
        id: uuidv4(),
        signalId: signalEventId,
        userId: sub.userId,
        status: "error",
        detail: result.detail,
      });
      errors++;
    }
  }

  return { processed: ok + errors, ok, errors };
}
