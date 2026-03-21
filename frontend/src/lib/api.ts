/**
 * Browser → relative `/api/*` with credentials (session cookie).
 * Dev: **127.0.0.1:8080** (Vite; `/api` → Next on 3000). Verify API: `curl http://127.0.0.1:3000/api/health` → `rexalgo-api`. Prod: nginx.
 * @see vite.config.ts | README.md#development | README.md#architecture
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getApiErrorCode(err: unknown): string | undefined {
  if (!(err instanceof ApiError) || err.body == null || typeof err.body !== "object") return undefined;
  const c = (err.body as { code?: unknown }).code;
  return typeof c === "string" ? c : undefined;
}

export function getApiErrorHint(err: unknown): string | undefined {
  if (!(err instanceof ApiError) || err.body == null || typeof err.body !== "object") return undefined;
  const h = (err.body as { hint?: unknown }).hint;
  return typeof h === "string" ? h : undefined;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await parseJson(res)) as T & { error?: string };

  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "error" in data && data.error
        ? String(data.error)
        : res.statusText;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

// ─── Auth ───────────────────────────────────────────────────────────

export async function login(apiSecret: string, displayName?: string) {
  return apiFetch<{ success: boolean; user: { id: string; displayName: string } }>(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({
        apiSecret: apiSecret.trim(),
        displayName: displayName?.trim(),
      }),
    }
  );
}

export async function logout() {
  return apiFetch<{ success: boolean }>("/api/auth/logout", { method: "POST" });
}

export type SessionMe = {
  user: { id: string; displayName: string } | null;
  /** When the HttpOnly JWT/session cookie expires (browser must sign in again). */
  sessionExpiresAt: string | null;
};

export async function getMe(): Promise<SessionMe> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  const data = (await res.json().catch(() => ({}))) as {
    user?: { id: string; displayName: string } | null;
    sessionExpiresAt?: string | null;
  };
  if (!res.ok) {
    return { user: null, sessionExpiresAt: null };
  }
  return {
    user: data.user ?? null,
    sessionExpiresAt:
      typeof data.sessionExpiresAt === "string" ? data.sessionExpiresAt : null,
  };
}

/** Server-configured session length + Mudrex key rotation hint (sign-in page). */
export async function fetchSessionInfo(): Promise<{
  sessionMaxAgeDays: number;
  mudrexKeyMaxDays: number;
}> {
  const res = await fetch("/api/auth/session-info");
  const data = (await res.json().catch(() => ({}))) as {
    sessionMaxAgeDays?: number;
    mudrexKeyMaxDays?: number;
  };
  if (!res.ok) {
    return { sessionMaxAgeDays: 90, mudrexKeyMaxDays: 90 };
  }
  return {
    sessionMaxAgeDays: typeof data.sessionMaxAgeDays === "number" ? data.sessionMaxAgeDays : 90,
    mudrexKeyMaxDays: typeof data.mudrexKeyMaxDays === "number" ? data.mudrexKeyMaxDays : 90,
  };
}

// ─── Strategies ─────────────────────────────────────────────────────

export type ApiStrategy = {
  id: string;
  creatorId: string;
  creatorName: string;
  name: string;
  description: string;
  type: "copy_trading" | "algo";
  symbol: string;
  side: string;
  leverage: string;
  stoplossPct: number | null;
  takeprofitPct: number | null;
  riskLevel: "low" | "medium" | "high";
  timeframe: string | null;
  isActive: boolean;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  subscriberCount: number;
  createdAt: string;
};

export async function fetchStrategies(params?: { type?: string }) {
  const q = new URLSearchParams();
  if (params?.type) q.set("type", params.type);
  const qs = q.toString();
  return apiFetch<{ strategies: ApiStrategy[] }>(
    `/api/strategies${qs ? `?${qs}` : ""}`
  );
}

export async function fetchStrategy(id: string) {
  return apiFetch<{ strategy: ApiStrategy }>(`/api/strategies/${id}`);
}

export async function patchStrategy(
  id: string,
  body: Partial<{
    name: string;
    description: string;
    symbol: string;
    side: "LONG" | "SHORT" | "BOTH";
    leverage: string;
    stoplossPct: number | null;
    takeprofitPct: number | null;
    riskLevel: "low" | "medium" | "high";
    timeframe: string | null;
    isActive: boolean;
  }>
) {
  return apiFetch<{ strategy: ApiStrategy }>(`/api/strategies/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ─── Copy trading — Master studio ───────────────────────────────────

export type StudioStrategyRow = ApiStrategy & {
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookPath: string;
};

export async function fetchCopyStudioStrategies() {
  return apiFetch<{
    strategies: StudioStrategyRow[];
    publicBaseUrl: string | null;
  }>("/api/copy-trading/studio/strategies");
}

export async function createCopyStudioStrategy(body: {
  name: string;
  description: string;
  symbol: string;
  side: "LONG" | "SHORT" | "BOTH";
  leverage?: string;
  riskLevel?: "low" | "medium" | "high";
  timeframe?: string;
  stoplossPct?: number | null;
  takeprofitPct?: number | null;
}) {
  return apiFetch<{ strategy: StudioStrategyRow }>(
    "/api/copy-trading/studio/strategies",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function setCopyStrategyWebhook(
  strategyId: string,
  action: "enable" | "disable" | "rotate"
) {
  return apiFetch<{
    ok: boolean;
    enabled: boolean;
    secretPlain?: string | null;
    shownOnce?: boolean;
    message?: string;
  }>(`/api/copy-trading/studio/strategies/${strategyId}/webhook`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export type CopySignalRow = {
  id: string;
  idempotencyKey: string;
  receivedAt: string;
  clientIp: string | null;
  payload: unknown;
  mirror: { ok: number; err: number };
};

export async function fetchCopyStrategySignals(strategyId: string) {
  return apiFetch<{ signals: CopySignalRow[] }>(
    `/api/copy-trading/studio/strategies/${strategyId}/signals`
  );
}

// ─── Marketplace — Strategy studio (algo) ───────────────────────────

export async function fetchMarketplaceStudioStrategies() {
  return apiFetch<{
    strategies: StudioStrategyRow[];
    publicBaseUrl: string | null;
  }>("/api/marketplace/studio/strategies");
}

export async function createMarketplaceStudioStrategy(body: {
  name: string;
  description: string;
  symbol: string;
  side: "LONG" | "SHORT" | "BOTH";
  leverage?: string;
  riskLevel?: "low" | "medium" | "high";
  timeframe?: string;
  stoplossPct?: number | null;
  takeprofitPct?: number | null;
}) {
  return apiFetch<{ strategy: StudioStrategyRow }>(
    "/api/marketplace/studio/strategies",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function setMarketplaceStrategyWebhook(
  strategyId: string,
  action: "enable" | "disable" | "rotate"
) {
  return apiFetch<{
    ok: boolean;
    enabled: boolean;
    secretPlain?: string | null;
    shownOnce?: boolean;
    message?: string;
  }>(`/api/marketplace/studio/strategies/${strategyId}/webhook`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function fetchMarketplaceStrategySignals(strategyId: string) {
  return apiFetch<{ signals: CopySignalRow[] }>(
    `/api/marketplace/studio/strategies/${strategyId}/signals`
  );
}

export async function subscribe(strategyId: string, marginPerTrade: string) {
  return apiFetch<{ success: boolean; subscriptionId: string }>(
    "/api/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({ strategyId, marginPerTrade }),
    }
  );
}

// ─── Mudrex (via backend) ───────────────────────────────────────────

export type WalletResponse = {
  spot?: {
    total: string;
    withdrawable: string;
    invested: string;
    rewards: string;
  };
  futures: {
    balance: string;
    locked_amount: string;
    unrealized_pnl: string;
  };
};

/** Pass `{ futuresOnly: true }` to skip spot — one Mudrex call, less rate-limit pressure. */
export async function fetchWallet(options?: { futuresOnly?: boolean }) {
  const q = options?.futuresOnly ? "?futuresOnly=1" : "";
  return apiFetch<WalletResponse>(`/api/mudrex/wallet${q}`);
}

export type ApiPosition = {
  position_id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: string;
  entry_price: string;
  mark_price: string;
  leverage: string;
  unrealized_pnl: string;
  realized_pnl?: string;
  margin?: string;
  status?: string;
  closed_at?: string;
  updated_at?: string;
  created_at?: string;
};

export async function fetchPositions() {
  return apiFetch<{ positions: ApiPosition[] }>("/api/mudrex/positions");
}

export async function fetchPositionHistory() {
  return apiFetch<{ positions: ApiPosition[] }>(
    "/api/mudrex/positions?history=true"
  );
}

export type SubscriptionStrategySummary = {
  id: string;
  name: string;
  type: "copy_trading" | "algo";
  symbol: string;
  leverage: string;
  isActive: boolean;
  creatorName: string;
};

export type ApiSubscription = {
  id: string;
  userId: string;
  strategyId: string;
  marginPerTrade: string;
  isActive: boolean;
  createdAt: string;
  strategy: SubscriptionStrategySummary;
};

export async function fetchSubscriptions() {
  return apiFetch<{ subscriptions: ApiSubscription[] }>("/api/subscriptions");
}

export async function cancelSubscription(subscriptionId: string) {
  return apiFetch<{ success: boolean }>("/api/subscriptions", {
    method: "DELETE",
    body: JSON.stringify({ subscriptionId }),
  });
}

export async function updateSubscriptionMargin(
  subscriptionId: string,
  marginPerTrade: string
) {
  return apiFetch<{ success: boolean; marginPerTrade: string }>(
    `/api/subscriptions/${subscriptionId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ marginPerTrade }),
    }
  );
}
