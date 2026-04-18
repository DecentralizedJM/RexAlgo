/**
 * Parse a TradingView-style alert payload into one of our internal trade intents.
 *
 * TV alerts are POSTed as the body of a user-defined JSON template — we cannot
 * dictate the exact keys, but we accept a handful of common shapes:
 *
 *   1. "RexAlgo native" envelope (same as copy-trade webhooks):
 *      {
 *        "idempotency_key": "...",
 *        "action": "open" | "close",
 *        "symbol": "BTCUSDT",
 *        "side": "LONG" | "SHORT",
 *        "trigger_type": "MARKET" | "LIMIT",
 *        "price": "..."                     // required for LIMIT
 *      }
 *
 *   2. A trader-friendly TradingView alert template:
 *      {
 *        "ticker": "{{ticker}}",            // BTCUSDT.P, BINANCE:BTCUSDT, etc.
 *        "action": "buy" | "sell" | "exit" | "close" | "long" | "short",
 *        "qty":    "0.01" | "5%" | "25 USDT",   // manual mode only
 *        "orderType": "market" | "limit",
 *        "price":  "{{close}}",
 *        "id":     "{{timenow}}"            // used as idempotency key
 *      }
 *
 * Unknown fields are ignored. Obvious mismatches (missing symbol, invalid side)
 * return `{ ok: false }` so the webhook route can log the rejection and return a
 * 400. We intentionally stay permissive: everything that can be mapped to the
 * signed copy-trade schema goes through `parseCopySignalV1`, which remains the
 * single source of truth for signal validation.
 *
 * @see backend/src/lib/copyMirror.ts#parseCopySignalV1
 */
import crypto from "crypto";
import { parseCopySignalV1, type CopySignalV1 } from "@/lib/copyMirror";

/** A single Mudrex order on the webhook owner's account. */
export type ManualTradeIntent = {
  kind: "manual_trade";
  idempotency_key: string;
  symbol: string;
  side: "LONG" | "SHORT";
  /** `"open"` places an order, `"close"` closes the matching open position. */
  action: "open" | "close";
  trigger_type: "MARKET" | "LIMIT";
  price?: string;
  /**
   * Optional USDT margin override parsed from `qty: "25 USDT"` alerts. When
   * absent, the TV webhook route falls back to `tvWebhooks.maxMarginUsdt`.
   */
  marginUsdtHint?: number;
};

export type ParsedTvAlert =
  | { ok: true; route: { kind: "copy_signal"; signal: CopySignalV1 } }
  | { ok: true; route: ManualTradeIntent }
  | { ok: false; reason: string };

/** Normalise TradingView ticker forms to plain uppercase Mudrex symbols. */
function normaliseSymbol(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim().toUpperCase();
  if (!s) return "";
  const colon = s.lastIndexOf(":");
  if (colon >= 0) s = s.slice(colon + 1);
  if (s.endsWith(".P") || s.endsWith(".PERP")) {
    s = s.slice(0, s.lastIndexOf("."));
  }
  s = s.replace(/[^A-Z0-9]/g, "");
  return s;
}

function normaliseSide(raw: unknown): "LONG" | "SHORT" | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (s === "LONG" || s === "BUY") return "LONG";
  if (s === "SHORT" || s === "SELL") return "SHORT";
  return null;
}

function inferActionFromAlert(raw: unknown):
  | { action: "open" | "close"; side?: "LONG" | "SHORT" }
  | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (s === "BUY" || s === "LONG" || s === "OPEN_LONG") {
    return { action: "open", side: "LONG" };
  }
  if (s === "SELL" || s === "SHORT" || s === "OPEN_SHORT") {
    return { action: "open", side: "SHORT" };
  }
  if (s === "CLOSE" || s === "EXIT" || s === "CLOSE_LONG" || s === "CLOSE_SHORT") {
    const side =
      s === "CLOSE_LONG" ? "LONG" : s === "CLOSE_SHORT" ? "SHORT" : undefined;
    return { action: "close", side };
  }
  if (s === "OPEN") return { action: "open" };
  return null;
}

function parseMarginHint(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const m = raw.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(USDT|USD)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/**
 * Try the native copy-signal shape first, then fall back to the trader-friendly
 * template for manual-trade routes.
 *
 * `mode` decides which adapter is *tried*:
 *   - `route_to_strategy` only accepts native copy-signal shapes.
 *   - `manual_trade` accepts either, but returns a ManualTradeIntent.
 */
export function parseTvAlert(
  body: unknown,
  mode: "manual_trade" | "route_to_strategy"
): ParsedTvAlert {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "Body must be a JSON object" };
  }

  const native = parseCopySignalV1(body);
  if (native.ok) {
    if (mode === "route_to_strategy") {
      return { ok: true, route: { kind: "copy_signal", signal: native.signal } };
    }
    return {
      ok: true,
      route: {
        kind: "manual_trade",
        idempotency_key: native.signal.idempotency_key,
        symbol: native.signal.symbol,
        side: native.signal.side,
        action: native.signal.action,
        trigger_type: native.signal.trigger_type,
        price: native.signal.price,
      },
    };
  }

  if (mode === "route_to_strategy") {
    return {
      ok: false,
      reason: `route_to_strategy requires the signed copy-signal schema: ${native.reason}`,
    };
  }

  const o = body as Record<string, unknown>;
  const idempotency_key =
    typeof o.idempotency_key === "string" && o.idempotency_key.trim()
      ? o.idempotency_key.trim()
      : typeof o.id === "string" && o.id.trim()
        ? o.id.trim()
        : `tv_${crypto.randomBytes(12).toString("hex")}`;

  const symbol =
    normaliseSymbol(o.symbol) ||
    normaliseSymbol(o.ticker) ||
    normaliseSymbol((o as { instrument?: unknown }).instrument);
  if (!symbol || !/^[A-Z0-9]{4,32}$/.test(symbol)) {
    return { ok: false, reason: "Unable to resolve a Mudrex symbol" };
  }

  const inferred = inferActionFromAlert(o.action ?? o.side);
  if (!inferred) {
    return {
      ok: false,
      reason: "action must be buy/sell/long/short/close or a copy-signal envelope",
    };
  }

  const explicitSide = normaliseSide(o.side);
  const side = inferred.side ?? explicitSide;
  if (!side) {
    return {
      ok: false,
      reason: "Unable to resolve LONG/SHORT side for manual trade",
    };
  }

  const orderTypeRaw =
    typeof o.orderType === "string"
      ? o.orderType
      : typeof o.trigger_type === "string"
        ? o.trigger_type
        : "market";
  const trigger_type =
    orderTypeRaw.toUpperCase() === "LIMIT" ? "LIMIT" : "MARKET";
  const priceRaw = o.price != null ? String(o.price).trim() : undefined;
  if (trigger_type === "LIMIT" && (!priceRaw || parseFloat(priceRaw) <= 0)) {
    return { ok: false, reason: "price required for LIMIT alerts" };
  }

  return {
    ok: true,
    route: {
      kind: "manual_trade",
      idempotency_key,
      symbol,
      side,
      action: inferred.action,
      trigger_type,
      price: trigger_type === "LIMIT" ? priceRaw : undefined,
      marginUsdtHint: parseMarginHint(o.qty ?? o.quantity ?? o.margin),
    },
  };
}
