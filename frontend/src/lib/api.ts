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

/** Mudrex rejected the stored API key — user should rotate the key in Mudrex and sign in again. */
export function isMudrexCredentialError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (getApiErrorCode(err) === "MUDREX_API_KEY_INVALID") return true;
  const msg = (err.message || "").toLowerCase();
  if (msg.includes("mudrex rejected")) return true;
  return false;
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

export type MasterAccessStatus = "none" | "pending" | "approved" | "rejected";

export type SessionUser = {
  id: string;
  displayName: string;
  email: string | null;
  hasMudrexKey: boolean;
  isAdmin?: boolean;
  masterAccess?: MasterAccessStatus;
  telegramId?: string | null;
  telegramUsername?: string | null;
  telegramNotifyEnabled?: boolean;
};

export async function loginWithGoogle(credential: string) {
  return apiFetch<{ success: boolean; user: SessionUser }>(
    "/api/auth/google",
    {
      method: "POST",
      body: JSON.stringify({ credential }),
    }
  );
}

export async function linkMudrexKey(apiSecret: string) {
  return apiFetch<{ success: boolean; user: SessionUser }>(
    "/api/auth/link-mudrex",
    {
      method: "POST",
      body: JSON.stringify({ apiSecret: apiSecret.trim() }),
    }
  );
}

export async function unlinkMudrexKey() {
  return apiFetch<{ success: boolean; user: SessionUser }>(
    "/api/auth/link-mudrex",
    { method: "DELETE" }
  );
}

/** @deprecated Use loginWithGoogle instead. Kept for legacy API-key-only login. */
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
  user: SessionUser | null;
  sessionExpiresAt: string | null;
};

export async function getMe(): Promise<SessionMe> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  const data = (await res.json().catch(() => ({}))) as {
    user?: SessionUser | null;
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

// ─── Master Studio access ──────────────────────────────────────────

export type MasterAccessRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type MasterAccessMe = {
  status: MasterAccessStatus;
  isAdmin: boolean;
  latest: MasterAccessRequest | null;
};

export async function fetchMasterAccessMe(): Promise<MasterAccessMe> {
  return apiFetch<MasterAccessMe>("/api/master-access/me");
}

export async function requestMasterAccess(note?: string) {
  return apiFetch<{
    ok: boolean;
    status: MasterAccessStatus;
    requestId?: string;
    message?: string;
  }>("/api/master-access/request", {
    method: "POST",
    body: JSON.stringify({ note: note?.trim() || undefined }),
  });
}

// ─── Admin ──────────────────────────────────────────────────────────

export type AdminMasterAccessRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  userStrategyCount: number;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export async function fetchAdminMasterAccess(
  status: "pending" | "approved" | "rejected" | "all" = "pending"
) {
  const params = new URLSearchParams({ status });
  return apiFetch<{ requests: AdminMasterAccessRow[] }>(
    `/api/admin/master-access?${params.toString()}`
  );
}

export async function reviewMasterAccess(
  id: string,
  action: "approve" | "reject",
  note?: string
) {
  return apiFetch<{ ok: boolean; id: string; status: MasterAccessStatus }>(
    `/api/admin/master-access/${id}`,
    {
      method: "POST",
      body: JSON.stringify({ action, note }),
    }
  );
}

export type AdminStrategyRow = {
  id: string;
  name: string;
  type: "algo" | "copy_trading";
  symbol: string;
  isActive: boolean;
  creatorId: string;
  creatorName: string;
  creatorEmail: string | null;
  createdAt: string;
  subscriberCount: number;
  webhookEnabled: boolean;
};

export async function fetchAdminStrategies(
  type: "algo" | "copy_trading" | "all" = "all"
) {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  return apiFetch<{ strategies: AdminStrategyRow[] }>(
    `/api/admin/strategies${params.toString() ? `?${params}` : ""}`
  );
}

export async function toggleAdminStrategy(id: string, active?: boolean) {
  return apiFetch<{ ok: boolean; id: string; isActive: boolean }>(
    `/api/admin/strategies/${id}/toggle`,
    {
      method: "POST",
      body:
        typeof active === "boolean"
          ? JSON.stringify({ active })
          : undefined,
    }
  );
}

export async function deleteAdminStrategy(id: string) {
  return apiFetch<{ ok: boolean; deleted: { id: string; name: string } }>(
    `/api/admin/strategies/${id}`,
    { method: "DELETE" }
  );
}

export type AdminUserRow = {
  id: string;
  email: string | null;
  displayName: string;
  authProvider: string;
  createdAt: string;
  strategyCount: number;
  masterStatus: string | null;
};

export async function fetchAdminUsers() {
  return apiFetch<{ users: AdminUserRow[] }>("/api/admin/users");
}

// ─── Strategies ─────────────────────────────────────────────────────

/** Stored on algo strategies; drives simulation for that listing only. */
export type StrategyBacktestSpec = {
  engine: "sma_cross";
  params: { fastPeriod: number; slowPeriod: number };
};

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
  /** Raw JSON from API; parse with {@link parseStrategyBacktestSpec}. */
  backtestSpecJson?: string | null;
  isActive: boolean;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  subscriberCount: number;
  createdAt: string;
};

export function parseStrategyBacktestSpec(
  raw: string | null | undefined
): StrategyBacktestSpec | null {
  if (raw == null || raw === "") return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const engine = (o as { engine?: string }).engine;
    const params = (o as { params?: unknown }).params;
    if (engine !== "sma_cross" || !params || typeof params !== "object") return null;
    const fastPeriod = Number((params as { fastPeriod?: unknown }).fastPeriod);
    const slowPeriod = Number((params as { slowPeriod?: unknown }).slowPeriod);
    if (
      !Number.isInteger(fastPeriod) ||
      !Number.isInteger(slowPeriod) ||
      fastPeriod < 2 ||
      slowPeriod < 2 ||
      fastPeriod >= slowPeriod
    ) {
      return null;
    }
    return { engine: "sma_cross", params: { fastPeriod, slowPeriod } };
  } catch {
    return null;
  }
}

export type StrategyBacktestTrade = {
  side: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  reason: "signal" | "stop" | "take_profit";
  pnlUsdt: number;
};

export type StrategyBacktestResultPayload = {
  summary: {
    initialCapital: number;
    finalEquity: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    winRatePct: number;
    tradeCount: number;
    feesApproxUsdt: number;
  };
  equity: { t: number; equity: number }[];
  trades: StrategyBacktestTrade[];
};

export async function runStrategyBacktest(
  strategyId: string,
  body: {
    lookbackMonths?: number;
    initialCapital?: number;
    riskPctPerTrade?: number;
    feeRoundTrip?: number;
  }
) {
  return apiFetch<{
    result: StrategyBacktestResultPayload;
    meta: { barsUsed: number; rangeStart: number; rangeEnd: number };
  }>(`/api/strategies/${strategyId}/backtest`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

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
    backtestSpec: StrategyBacktestSpec | null;
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
  /** Human-friendly webhook label (defaults to strategy name until renamed). */
  webhookName: string | null;
  webhookUrl: string | null;
  webhookPath: string;
  /** Most recent accepted delivery, as returned by the API. `null` if none yet. */
  webhookLastDeliveryAt: string | null;
  /** Last time the signing secret was rotated. `null` if never rotated since enable. */
  webhookRotatedAt: string | null;
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
    name?: string | null;
    secretPlain?: string | null;
    shownOnce?: boolean;
    message?: string;
  }>(`/api/copy-trading/studio/strategies/${strategyId}/webhook`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function renameCopyStrategyWebhook(
  strategyId: string,
  name: string
) {
  return apiFetch<{ ok: boolean; name: string }>(
    `/api/copy-trading/studio/strategies/${strategyId}/webhook`,
    { method: "PATCH", body: JSON.stringify({ name }) }
  );
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
  backtestSpec?: StrategyBacktestSpec;
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
    name?: string | null;
    secretPlain?: string | null;
    shownOnce?: boolean;
    message?: string;
  }>(`/api/marketplace/studio/strategies/${strategyId}/webhook`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function renameMarketplaceStrategyWebhook(
  strategyId: string,
  name: string
) {
  return apiFetch<{ ok: boolean; name: string }>(
    `/api/marketplace/studio/strategies/${strategyId}/webhook`,
    { method: "PATCH", body: JSON.stringify({ name }) }
  );
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

// ─── Telegram ───────────────────────────────────────────────────────

export type TelegramWidgetPayload = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export async function fetchTelegramConfig() {
  return apiFetch<{ enabled: boolean; botUsername: string | null }>(
    "/api/auth/telegram/config"
  );
}

export async function loginOrLinkWithTelegram(payload: TelegramWidgetPayload) {
  return apiFetch<{
    success: true;
    linked: boolean;
    user: SessionUser;
  }>("/api/auth/telegram", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function unlinkTelegram() {
  return apiFetch<{ ok: true }>("/api/auth/telegram", { method: "DELETE" });
}

export async function setTelegramNotifyEnabled(notifyEnabled: boolean) {
  return apiFetch<{ ok: true; notifyEnabled: boolean }>(
    "/api/auth/telegram",
    { method: "PATCH", body: JSON.stringify({ notifyEnabled }) }
  );
}

// ─── TV Webhooks ────────────────────────────────────────────────────

export type TvWebhookMode = "manual_trade" | "route_to_strategy";

export type TvWebhookRow = {
  id: string;
  name: string;
  enabled: boolean;
  mode: TvWebhookMode;
  strategyId: string | null;
  maxMarginUsdt: number;
  createdAt: string;
  rotatedAt: string | null;
  lastDeliveryAt: string | null;
  webhookUrl: string | null;
  webhookPath: string;
};

export type TvWebhookEvent = {
  id: string;
  idempotencyKey: string;
  status: "accepted" | "rejected" | "error";
  detail: string | null;
  receivedAt: string;
  clientIp: string | null;
  payload: unknown;
};

export async function fetchTvWebhooks() {
  return apiFetch<{ webhooks: TvWebhookRow[]; publicBaseUrl: string | null }>(
    "/api/tv-webhooks"
  );
}

export async function createTvWebhook(body: {
  name: string;
  mode: TvWebhookMode;
  strategyId?: string | null;
  maxMarginUsdt?: number;
}) {
  return apiFetch<{
    webhook: TvWebhookRow;
    secretPlain: string;
    shownOnce: true;
    message: string;
  }>("/api/tv-webhooks", { method: "POST", body: JSON.stringify(body) });
}

export async function patchTvWebhook(
  id: string,
  body: Partial<{
    name: string;
    enabled: boolean;
    mode: TvWebhookMode;
    strategyId: string | null;
    maxMarginUsdt: number;
  }>
) {
  return apiFetch<{ ok: true }>(`/api/tv-webhooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteTvWebhook(id: string) {
  return apiFetch<{ ok: true }>(`/api/tv-webhooks/${id}`, { method: "DELETE" });
}

export async function rotateTvWebhookSecret(id: string) {
  return apiFetch<{
    ok: true;
    secretPlain: string;
    shownOnce: true;
    message: string;
  }>(`/api/tv-webhooks/${id}/rotate`, { method: "POST" });
}

export async function fetchTvWebhookEvents(id: string) {
  return apiFetch<{ events: TvWebhookEvent[] }>(
    `/api/tv-webhooks/${id}/events`
  );
}
