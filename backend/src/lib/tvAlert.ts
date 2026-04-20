/**
 * Parse a TradingView-style alert payload into one of our internal trade intents.
 *
 * Supported shapes:
 *
 *   1. RexAlgo copy-signal envelope (for `route_to_strategy`, or advanced
 *      `manual_trade` users):
 *      {
 *        "idempotency_key": "...",
 *        "action": "open" | "close",
 *        "symbol": "BTCUSDT",
 *        "side": "LONG" | "SHORT",
 *        "trigger_type": "MARKET" | "LIMIT",
 *        "price": "..."
 *      }
 *
 *   2. Simple TradingView JSON (recommended for `manual_trade`):
 *      {
 *        "action": "buy" | "sell" | "long" | "short" | "close" | "exit",
 *        "symbol": "BTCUSDT",
 *        "leverage": 5,
 *        "qty": 0.01,
 *        "sl": 97000,
 *        "tp": 101000,
 *        "risk_pct": 2
 *      }
 *
 *   Optional `id` or `idempotency_key` — when set, duplicates reuse that key.
 *   When omitted, the webhook route dedupes by a stable hash of the raw body so
 *   TradingView retries do not double-place orders without extra JSON fields.
 *
 * @see backend/src/lib/copyMirror.ts#parseCopySignalV1
 */
import crypto from "crypto";
import { parseCopySignalV1, type CopySignalV1 } from "@/lib/copyMirror";

/** A single Mudrex order on the webhook owner's account. */
export type ManualTradeIntent = {
  kind: "manual_trade";
  symbol: string;
  side: "LONG" | "SHORT";
  /** `"open"` places an order, `"close"` closes the matching open position. */
  action: "open" | "close";
  trigger_type: "MARKET" | "LIMIT";
  price?: string;
  /** Parsed from `qty: "25 USDT"` when not using fixed contract qty. */
  marginUsdtHint?: number;
  /** Fixed base-asset quantity (contracts), when `qty` is a plain number. */
  baseQty?: number;
  /** 1–100 as string for Mudrex `createOrder`. */
  leverageStr?: string;
  stoplosPrice?: string;
  takeprofitPrice?: string;
  /** Percent of futures wallet balance to allocate (clamped to max margin cap). */
  riskPct?: number;
};

export type ParsedTvAlert =
  | {
      ok: true;
      route: { kind: "copy_signal"; signal: CopySignalV1 };
      clientIdempotencyKey: string;
    }
  | {
      ok: true;
      route: ManualTradeIntent;
      clientIdempotencyKey: string | null;
    }
  | { ok: false; reason: string };

/** Stable dedupe key: explicit client id, else SHA-256 of webhook + raw body. */
export function tvWebhookDedupeKey(
  webhookId: string,
  rawBody: string,
  clientExplicit: string | null
): string {
  const t = clientExplicit?.trim();
  if (t) return t;
  return `body:${crypto.createHash("sha256").update(`${webhookId}\n${rawBody}`).digest("hex")}`;
}

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

/** Plain numeric contract qty (not `"25 USDT"` margin hints). */
function parseBaseQty(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (/USDT|USD$/i.test(t)) return undefined;
    const n = parseFloat(t);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function coercePriceString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return String(n);
}

function parseRiskPct(o: Record<string, unknown>): number | undefined {
  const raw = o.risk_pct ?? o.riskPct;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(raw, 100);
  }
  if (typeof raw === "string") {
    const n = parseFloat(raw.trim());
    if (Number.isFinite(n) && n > 0) return Math.min(n, 100);
  }
  return undefined;
}

function parseLeverageField(raw: unknown): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const x = Math.min(100, Math.max(1, Math.round(raw)));
    return String(x);
  }
  if (typeof raw === "string") {
    const n = parseFloat(raw.trim());
    if (Number.isFinite(n) && n > 0) {
      const x = Math.min(100, Math.max(1, Math.round(n)));
      return String(x);
    }
  }
  return undefined;
}

function roundBaseQtyToStep(q: number, minQty: number, step: number): number {
  if (!Number.isFinite(q) || q <= 0) return 0;
  if (step <= 0 || !Number.isFinite(step)) return 0;
  const steps = Math.floor(q / step);
  let out = steps * step;
  if (out < minQty) {
    const minSteps = Math.ceil(minQty / step);
    out = minSteps * step;
  }
  return out;
}

export { roundBaseQtyToStep };

/**
 * Try the native copy-signal shape first, then fall back to the simple
 * TradingView template for manual-trade routes.
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
    const key = native.signal.idempotency_key;
    if (mode === "route_to_strategy") {
      return {
        ok: true,
        clientIdempotencyKey: key,
        route: { kind: "copy_signal", signal: native.signal },
      };
    }
    return {
      ok: true,
      clientIdempotencyKey: key,
      route: {
        kind: "manual_trade",
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
  const explicitKey =
    typeof o.idempotency_key === "string" && o.idempotency_key.trim()
      ? o.idempotency_key.trim()
      : typeof o.id === "string" && o.id.trim()
        ? o.id.trim()
        : null;

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
      reason:
        "action must be buy/sell/long/short/close/exit, or use the signed copy-signal envelope",
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

  const baseQty = parseBaseQty(o.qty) ?? parseBaseQty(o.quantity);
  const marginUsdtHint = baseQty
    ? undefined
    : parseMarginHint(o.qty ?? o.quantity ?? o.margin);

  return {
    ok: true,
    clientIdempotencyKey: explicitKey,
    route: {
      kind: "manual_trade",
      symbol,
      side,
      action: inferred.action,
      trigger_type,
      price: trigger_type === "LIMIT" ? priceRaw : undefined,
      marginUsdtHint,
      baseQty,
      leverageStr: parseLeverageField(o.leverage),
      stoplosPrice: coercePriceString(o.sl ?? o.stopLoss ?? o.stop_loss),
      takeprofitPrice: coercePriceString(o.tp ?? o.takeProfit ?? o.take_profit),
      riskPct: parseRiskPct(o),
    },
  };
}
