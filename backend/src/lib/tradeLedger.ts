import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { tradeLogs } from "@/lib/schema";
import type { MudrexOrder } from "@/types";
import { logger } from "@/lib/logger";

/**
 * Forward-looking local ledger of every order RexAlgo places on behalf of a
 * user. The admin dashboard aggregates USDT notional from these rows to
 * report per-user trading volume (email-indexed, not API-key-indexed).
 *
 * Writes are best-effort: we never want a ledger hiccup to fail the actual
 * order. All failures are logged but swallowed.
 *
 * `source` distinguishes the code path that placed the order:
 *   manual → dashboard / ad-hoc order (`/api/mudrex/orders`)
 *   copy   → copy-trade mirror fill (`lib/copyMirror.ts`)
 *   tv     → TradingView webhook manual_trade (`/api/webhooks/tv/[id]`)
 */
export type TradeLogSource = "manual" | "copy" | "tv";

export type LogTradeArgs = {
  userId: string;
  source: TradeLogSource;
  order: Pick<MudrexOrder, "order_id" | "symbol" | "order_type" | "quantity" | "price">;
  /** Optional strategy link (copy/tv route_to_strategy paths). */
  strategyId?: string | null;
  /**
   * Optional mark price fallback when the order response does not include a
   * filled price (e.g. MARKET orders on some exchanges return `price = "0"`
   * until the fill arrives via websocket). Used to compute notional.
   */
  markPriceFallback?: number | null;
};

/**
 * Record an order into the local ledger. Returns silently on failure so
 * callers do not need a try/catch.
 */
export async function logTrade(args: LogTradeArgs): Promise<void> {
  try {
    const qty = parseFloat(args.order.quantity ?? "0");
    const priceRaw = parseFloat(args.order.price ?? "0");
    // Mudrex returns a placeholder of 999999999 for MARKET orders that have
    // not filled yet; treat as "unknown" and fall back to the mark price if
    // the caller supplied one.
    const price =
      Number.isFinite(priceRaw) && priceRaw > 0 && priceRaw < 1e9
        ? priceRaw
        : args.markPriceFallback && args.markPriceFallback > 0
          ? args.markPriceFallback
          : null;

    const notional = price !== null ? qty * price : null;

    await db.insert(tradeLogs).values({
      id: uuidv4(),
      userId: args.userId,
      strategyId: args.strategyId ?? null,
      orderId: args.order.order_id ?? null,
      symbol: args.order.symbol,
      side: args.order.order_type,
      quantity: args.order.quantity,
      entryPrice: price !== null ? String(price) : null,
      source: args.source,
      notionalUsdt: notional !== null ? notional.toFixed(8) : null,
      status: "open",
    });
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        payload: {
          userId: args.userId,
          source: args.source,
          strategyId: args.strategyId ?? null,
          markPriceFallback: args.markPriceFallback ?? null,
          order: args.order,
        },
      },
      "[trade-ledger] insert failed"
    );
  }
}
