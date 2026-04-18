/**
 * Outbound Mudrex Futures REST client (https://trade.mudrex.com/fapi/v1).
 * Used by API routes after loading the user's encrypted API secret via auth.ts.
 * @see README.md#architecture — backend module diagram
 * @see repo/project.json — stack.frontend / stack.backend
 */
import type {
  MudrexWalletBalance,
  MudrexFuturesBalance,
  MudrexAsset,
  MudrexOrder,
  MudrexPosition,
  MudrexLeverage,
  CreateOrderParams,
} from "@/types";

const BASE_URL = "https://trade.mudrex.com/fapi/v1";

/** Max attempts when Mudrex returns 429 / 503 (rate limit / overload). */
const MUDREX_RETRYABLE_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MudrexAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "MudrexAPIError";
  }
}

async function mudrexFetch(
  endpoint: string,
  apiSecret: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = `${BASE_URL}${endpoint}`;

  for (let attempt = 0; attempt < MUDREX_RETRYABLE_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        "X-Authentication": apiSecret,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });

    const retryable = res.status === 429 || res.status === 503;
    if (retryable && attempt < MUDREX_RETRYABLE_ATTEMPTS - 1) {
      const ra = res.headers.get("retry-after");
      let delayMs = 500 * 2 ** attempt;
      if (ra) {
        const sec = Number.parseInt(ra, 10);
        if (!Number.isNaN(sec) && sec > 0) {
          delayMs = Math.max(delayMs, sec * 1000);
        }
      }
      delayMs = Math.min(delayMs, 60_000);
      await res.arrayBuffer().catch(() => undefined);
      await sleep(delayMs);
      continue;
    }

    const data = await res.json().catch(() => ({
      success: false,
      message: res.statusText,
    }));

    if (!res.ok) {
      let msg =
        typeof (data as { message?: string })?.message === "string"
          ? (data as { message: string }).message
          : `API error ${res.status}`;
      if (res.status === 401) {
        msg =
          "Mudrex rejected this API key (expired, revoked, or invalid). Create a new API key in the Mudrex app and sign in again here.";
      }
      throw new MudrexAPIError(msg, res.status, data);
    }

    return data;
  }

  throw new MudrexAPIError("Too Many Requests", 429, {
    success: false,
    message: "Too Many Requests",
  });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

/** Prefer `data`, else root (Mudrex may wrap or return flat fields). */
function unwrapPayload(res: unknown): Record<string, unknown> | null {
  const r = asRecord(res);
  if (!r) return null;
  const inner = asRecord(r.data);
  if (inner) return inner;
  return r;
}

function pickStr(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = payload[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return "0";
}

function pickBool(payload: Record<string, unknown>, ...keys: string[]): boolean {
  for (const k of keys) {
    const v = payload[k];
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
  }
  return false;
}

/** First non-empty string among keys, or `undefined` if none (unlike `pickStr`, which returns `"0"`). */
function pickOptionalStr(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = payload[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return undefined;
}

function parseFiniteNumber(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * When Mudrex omits explicit realized PnL on history rows, approximate USDT PnL for linear-style qty
 * (base-asset size × price delta). Does not include fees.
 */
function approximateClosedPnlUsdt(payload: Record<string, unknown>): string | undefined {
  const entry = parseFiniteNumber(
    pickOptionalStr(payload, "entry_price", "entryPrice", "avg_entry_price", "average_entry_price")
  );
  const exitPx = parseFiniteNumber(
    pickOptionalStr(
      payload,
      "closed_price",
      "exit_price",
      "close_price",
      "average_close_price",
      "avg_close_price",
      "mark_price",
      "markPrice",
      "last_price",
      "lastPrice"
    )
  );
  const qty = parseFiniteNumber(
    pickOptionalStr(payload, "quantity", "qty", "filled_quantity", "filled_qty")
  );
  const sideRaw = (
    pickOptionalStr(payload, "side", "order_type", "orderType") || "LONG"
  ).toUpperCase();
  const isShort = sideRaw === "SHORT";
  if (entry === undefined || exitPx === undefined || qty === undefined) return undefined;
  if (entry <= 0 || exitPx <= 0 || qty <= 0) return undefined;
  const pnl = isShort ? (entry - exitPx) * qty : (exitPx - entry) * qty;
  return String(pnl);
}

type MapMudrexPositionOpts = { assumeClosed?: boolean };

/**
 * Normalize Mudrex position / history payloads (snake_case vs camelCase, `id` vs `position_id`,
 * `order_type` vs `side`, British `realised_*`, removed PnL fields per v1.0.4 changelog).
 */
function mapMudrexPosition(
  raw: unknown,
  opts?: MapMudrexPositionOpts
): MudrexPosition {
  const r = asRecord(raw);
  if (!r) {
    return {
      position_id: "",
      asset_id: "",
      symbol: "",
      side: "LONG",
      quantity: "0",
      entry_price: "0",
      mark_price: "0",
      leverage: "0",
      margin: "0",
      unrealized_pnl: "0",
      realized_pnl: "0",
      status: "",
    };
  }

  const positionId =
    pickOptionalStr(r, "position_id", "positionId", "id") ?? "";
  const assetId =
    pickOptionalStr(r, "asset_id", "assetId", "asset_uuid", "assetUuid") ?? "";

  const sideRaw = (
    pickOptionalStr(r, "side", "order_type", "orderType") || "LONG"
  ).toUpperCase();
  const side: "LONG" | "SHORT" = sideRaw === "SHORT" ? "SHORT" : "LONG";

  const symbol = pickStr(r, "symbol", "Symbol");
  const quantity = pickStr(r, "quantity", "qty", "filled_quantity", "filled_qty");
  const entry_price = pickStr(
    r,
    "entry_price",
    "entryPrice",
    "avg_entry_price",
    "average_entry_price"
  );

  const markExplicit = pickOptionalStr(
    r,
    "mark_price",
    "markPrice",
    "closed_price",
    "exit_price",
    "close_price",
    "average_close_price",
    "avg_close_price",
    "last_price",
    "lastPrice",
    "index_price"
  );
  const mark_price =
    markExplicit ?? (entry_price !== "0" && entry_price.trim() !== "" ? entry_price : "0");

  const leverage = pickStr(r, "leverage", "leverage_multiplier");
  const margin = pickStr(r, "margin", "initial_margin", "position_margin");

  const unrealized = pickStr(
    r,
    "unrealized_pnl",
    "unrealizedPnl",
    "unrealised_pnl",
    "unrealisedPnl"
  );

  const status = (pickOptionalStr(r, "status", "state") ?? "").toUpperCase();
  const hasClosedAt =
    pickOptionalStr(r, "closed_at", "closedAt", "closed_time") !== undefined;
  const isClosedPosition =
    opts?.assumeClosed === true ||
    hasClosedAt ||
    status.includes("CLOSE") ||
    status === "CLOSED" ||
    status === "FILLED" ||
    status === "COMPLETED";

  let realized = pickOptionalStr(
    r,
    "realized_pnl",
    "realizedPnl",
    "realised_pnl",
    "realisedPnl",
    "realized_profit",
    "closed_pnl",
    "closedPnl",
    "net_pnl",
    "netPnl"
  );
  if (realized === undefined && isClosedPosition) {
    const gross = pickOptionalStr(
      r,
      "gross_pnl",
      "grossPnl",
      "total_pnl",
      "totalPnl",
      "pnl",
      "profit"
    );
    if (gross !== undefined) realized = gross;
  }
  if (realized === undefined && isClosedPosition) {
    const approx = approximateClosedPnlUsdt(r);
    if (approx !== undefined) realized = approx;
  }
  const realized_pnl = realized ?? "0";

  const liquidation_price = pickOptionalStr(r, "liquidation_price", "liquidationPrice");
  const stoploss_price = pickOptionalStr(r, "stoploss_price", "stoplossPrice");
  const takeprofit_price = pickOptionalStr(r, "takeprofit_price", "takeprofitPrice");
  const closed_at = pickOptionalStr(r, "closed_at", "closedAt", "closed_time");
  const updated_at = pickOptionalStr(r, "updated_at", "updatedAt");
  const created_at = pickOptionalStr(r, "created_at", "createdAt");

  const stoploss = r.stoploss as MudrexPosition["stoploss"];
  const takeprofit = r.takeprofit as MudrexPosition["takeprofit"];

  const out: MudrexPosition = {
    position_id: positionId,
    asset_id: assetId,
    symbol,
    side,
    quantity,
    entry_price,
    mark_price,
    leverage,
    margin,
    unrealized_pnl: unrealized,
    realized_pnl,
    status: pickOptionalStr(r, "status", "state") ?? "",
  };
  if (liquidation_price) out.liquidation_price = liquidation_price;
  if (stoploss_price) out.stoploss_price = stoploss_price;
  if (takeprofit_price) out.takeprofit_price = takeprofit_price;
  if (closed_at) out.closed_at = closed_at;
  if (updated_at) out.updated_at = updated_at;
  if (created_at) out.created_at = created_at;
  if (stoploss && typeof stoploss === "object") out.stoploss = stoploss;
  if (takeprofit && typeof takeprofit === "object") out.takeprofit = takeprofit;

  return out;
}

function mapMudrexPositionList(
  data: unknown[] | { items?: unknown[] } | null | undefined,
  opts?: MapMudrexPositionOpts
): MudrexPosition[] {
  if (!data) return [];
  const arr = Array.isArray(data) ? data : data.items ?? [];
  return arr.map((row) => mapMudrexPosition(row, opts));
}

function mapSpotPayload(payload: Record<string, unknown> | null): MudrexWalletBalance {
  if (!payload) {
    return {
      total: "0",
      withdrawable: "0",
      invested: "0",
      rewards: "0",
      currency: "USDT",
    };
  }
  return {
    total: pickStr(payload, "total", "total_balance", "balance"),
    withdrawable: pickStr(
      payload,
      "withdrawable",
      "available",
      "available_balance",
      "transferable"
    ),
    invested: pickStr(payload, "invested", "invested_amount", "in_orders"),
    rewards: pickStr(payload, "rewards", "reward"),
    currency:
      payload.currency != null && String(payload.currency).trim() !== ""
        ? String(payload.currency)
        : "USDT",
  };
}

function mapFuturesPayload(payload: Record<string, unknown> | null): MudrexFuturesBalance {
  if (!payload) {
    return {
      balance: "0",
      locked_amount: "0",
      unrealized_pnl: "0",
      first_time_user: false,
    };
  }
  return {
    balance: pickStr(
      payload,
      "balance",
      "wallet_balance",
      "walletBalance",
      "totalWalletBalance",
      "crossWalletBalance",
      "marginBalance",
      "futures_balance",
      "total",
      "total_balance",
      "available_balance",
      "availableBalance"
    ),
    locked_amount: pickStr(
      payload,
      "locked_amount",
      "lockedAmount",
      "locked",
      "margin_locked",
      "usedMargin",
      "totalInitialMargin"
    ),
    unrealized_pnl: pickStr(
      payload,
      "unrealized_pnl",
      "unrealizedPnl",
      "unrealised_pnl"
    ),
    first_time_user: pickBool(payload, "first_time_user", "firstTimeUser"),
  };
}

// ─── Wallet ──────────────────────────────────────────────────────────

export async function getSpotBalance(
  apiSecret: string
): Promise<MudrexWalletBalance> {
  // Docs: GET /wallet/funds; fallback POST for older / alternate gateways
  try {
    const res = await mudrexFetch("/wallet/funds", apiSecret, { method: "GET" });
    return mapSpotPayload(unwrapPayload(res));
  } catch (e) {
    // Do not fall back on rate limits — that doubles traffic and worsens 429s
    if (e instanceof MudrexAPIError && (e.statusCode === 429 || e.statusCode === 503)) {
      throw e;
    }
    const res = await mudrexFetch("/wallet/funds", apiSecret, {
      method: "POST",
      body: "{}",
    });
    return mapSpotPayload(unwrapPayload(res));
  }
}

export async function getFuturesBalance(
  apiSecret: string
): Promise<MudrexFuturesBalance> {
  // Docs: POST /futures/funds; fallback GET for compatibility
  try {
    const res = await mudrexFetch("/futures/funds", apiSecret, {
      method: "POST",
      body: "{}",
    });
    return mapFuturesPayload(unwrapPayload(res));
  } catch (e) {
    if (e instanceof MudrexAPIError && (e.statusCode === 429 || e.statusCode === 503)) {
      throw e;
    }
    const res = await mudrexFetch("/futures/funds", apiSecret, { method: "GET" });
    return mapFuturesPayload(unwrapPayload(res));
  }
}

export async function transferFunds(
  apiSecret: string,
  fromWallet: "SPOT" | "FUTURES",
  toWallet: "SPOT" | "FUTURES",
  amount: string
): Promise<{ success: boolean }> {
  const res = (await mudrexFetch("/wallet/futures/transfer", apiSecret, {
    method: "POST",
    body: JSON.stringify({
      from_wallet_type: fromWallet,
      to_wallet_type: toWallet,
      amount,
    }),
  })) as { success: boolean };
  return res;
}

// ─── Assets ──────────────────────────────────────────────────────────

export async function listAssets(
  apiSecret: string,
  offset = 0,
  limit = 100
): Promise<MudrexAsset[]> {
  const res = (await mudrexFetch(
    `/futures?offset=${offset}&limit=${limit}`,
    apiSecret
  )) as { data?: MudrexAsset[] | { items?: MudrexAsset[] } };

  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && "items" in data) return data.items ?? [];
  return [];
}

export async function listAllAssets(
  apiSecret: string
): Promise<MudrexAsset[]> {
  const allAssets: MudrexAsset[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const batch = await listAssets(apiSecret, offset, limit);
    if (batch.length === 0) break;
    allAssets.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
    await sleep(80);
  }

  return allAssets;
}

export async function getAsset(
  apiSecret: string,
  symbol: string
): Promise<MudrexAsset> {
  const res = (await mudrexFetch(
    `/futures/${symbol}?is_symbol=true`,
    apiSecret
  )) as { data?: MudrexAsset };
  if (!res.data) throw new MudrexAPIError("Asset not found", 404);
  return res.data;
}

// ─── Leverage ────────────────────────────────────────────────────────

export async function getLeverage(
  apiSecret: string,
  symbol: string
): Promise<MudrexLeverage> {
  try {
    const res = (await mudrexFetch(
      `/futures/${symbol}/leverage?is_symbol=true`,
      apiSecret
    )) as { data?: MudrexLeverage };
    return (
      res.data ?? {
        asset_id: symbol,
        symbol,
        leverage: "1",
        margin_type: "ISOLATED",
      }
    );
  } catch {
    return {
      asset_id: symbol,
      symbol,
      leverage: "1",
      margin_type: "ISOLATED",
    };
  }
}

export async function setLeverage(
  apiSecret: string,
  symbol: string,
  leverage: string,
  marginType = "ISOLATED"
): Promise<MudrexLeverage> {
  const res = (await mudrexFetch(
    `/futures/${symbol}/leverage?is_symbol=true`,
    apiSecret,
    {
      method: "POST",
      body: JSON.stringify({ margin_type: marginType, leverage }),
    }
  )) as { data?: MudrexLeverage };
  return (
    res.data ?? { asset_id: symbol, symbol, leverage, margin_type: marginType }
  );
}

// ─── Orders ──────────────────────────────────────────────────────────

export async function createOrder(
  apiSecret: string,
  params: CreateOrderParams
): Promise<MudrexOrder> {
  const body: Record<string, unknown> = {
    leverage: parseFloat(params.leverage),
    quantity: parseFloat(params.quantity),
    order_type: params.side,
    trigger_type: params.triggerType,
    reduce_only: params.reduceOnly ?? false,
  };

  if (params.triggerType === "LIMIT" && params.price) {
    body.order_price = parseFloat(params.price);
  } else {
    body.order_price = 999999999;
  }

  if (params.stoplosPrice) {
    body.is_stoploss = true;
    body.stoploss_price = parseFloat(params.stoplosPrice);
  }

  if (params.takeprofitPrice) {
    body.is_takeprofit = true;
    body.takeprofit_price = parseFloat(params.takeprofitPrice);
  }

  const res = (await mudrexFetch(
    `/futures/${params.symbol}/order?is_symbol=true`,
    apiSecret,
    { method: "POST", body: JSON.stringify(body) }
  )) as { data?: MudrexOrder };

  if (!res.data) throw new MudrexAPIError("Failed to create order", 500);
  return res.data;
}

export async function listOpenOrders(
  apiSecret: string
): Promise<MudrexOrder[]> {
  const res = (await mudrexFetch("/futures/orders", apiSecret)) as {
    data?: MudrexOrder[] | { items?: MudrexOrder[] };
  };
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && "items" in data) return data.items ?? [];
  return [];
}

export async function getOrderHistory(
  apiSecret: string,
  page = 1,
  perPage = 50
): Promise<MudrexOrder[]> {
  const res = (await mudrexFetch(
    `/futures/orders/history?page=${page}&per_page=${perPage}`,
    apiSecret
  )) as { data?: MudrexOrder[] | { items?: MudrexOrder[] } };
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && "items" in data) return data.items ?? [];
  return [];
}

export async function cancelOrder(
  apiSecret: string,
  orderId: string
): Promise<boolean> {
  const res = (await mudrexFetch(`/futures/orders/${orderId}`, apiSecret, {
    method: "DELETE",
  })) as { success?: boolean };
  return res.success ?? false;
}

// ─── Positions ───────────────────────────────────────────────────────

export async function listOpenPositions(
  apiSecret: string
): Promise<MudrexPosition[]> {
  const res = (await mudrexFetch("/futures/positions", apiSecret)) as {
    data?: MudrexPosition[] | { items?: MudrexPosition[] } | null;
  };
  const data = res.data;
  if (!data) return [];
  return mapMudrexPositionList(data as unknown[] | { items?: unknown[] });
}

export async function closePosition(
  apiSecret: string,
  positionId: string
): Promise<boolean> {
  const res = (await mudrexFetch(
    `/futures/positions/${positionId}/close`,
    apiSecret,
    { method: "POST" }
  )) as { success?: boolean };
  return res.success ?? false;
}

export async function setPositionRisk(
  apiSecret: string,
  positionId: string,
  stoplosPrice?: string,
  takeprofitPrice?: string
): Promise<boolean> {
  const body: Record<string, unknown> = { order_source: "API" };
  if (stoplosPrice) {
    body.stoploss_price = stoplosPrice;
    body.is_stoploss = true;
  }
  if (takeprofitPrice) {
    body.takeprofit_price = takeprofitPrice;
    body.is_takeprofit = true;
  }

  const res = (await mudrexFetch(
    `/futures/positions/${positionId}/riskorder`,
    apiSecret,
    { method: "POST", body: JSON.stringify(body) }
  )) as { success?: boolean };
  return res.success ?? false;
}

export async function getPositionHistory(
  apiSecret: string,
  page = 1,
  perPage = 50
): Promise<MudrexPosition[]> {
  const res = (await mudrexFetch(
    `/futures/positions/history?page=${page}&per_page=${perPage}`,
    apiSecret
  )) as { data?: MudrexPosition[] | { items?: MudrexPosition[] } | null };
  const data = res.data;
  if (!data) return [];
  return mapMudrexPositionList(data as unknown[] | { items?: unknown[] }, {
    assumeClosed: true,
  });
}

export async function validateApiSecret(
  apiSecret: string
): Promise<boolean> {
  try {
    await getFuturesBalance(apiSecret);
    return true;
  } catch {
    return false;
  }
}
