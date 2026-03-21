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

class MudrexAPIError extends Error {
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
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-Authentication": apiSecret,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });

  const data = await res.json().catch(() => ({ success: false, message: res.statusText }));

  if (!res.ok) {
    throw new MudrexAPIError(
      data?.message || `API error ${res.status}`,
      res.status,
      data
    );
  }

  return data;
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
      "available_balance",
      "futures_balance",
      "total",
      "total_balance"
    ),
    locked_amount: pickStr(
      payload,
      "locked_amount",
      "locked",
      "margin_locked"
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
  } catch {
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
  } catch {
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
    data?: MudrexPosition[] | { items?: MudrexPosition[] };
  };
  const data = res.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if ("items" in data) return data.items ?? [];
  return [];
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
  )) as { data?: MudrexPosition[] | { items?: MudrexPosition[] } };
  const data = res.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if ("items" in data) return data.items ?? [];
  return [];
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
