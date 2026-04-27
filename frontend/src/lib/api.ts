/**
 * Browser → relative `/api/*` with credentials (session cookie).
 * Dev: **127.0.0.1:8080** (Vite; `/api` → Next on 3000). Verify API: `curl http://127.0.0.1:3000/api/health` → `rexalgo-api`. Prod: nginx.
 * @see vite.config.ts | README.md#development | README.md#architecture
 */

import { reportClientEvent } from "@/lib/telemetry";
import type { MarginCurrency } from "@/lib/subscriptionCurrency";

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
    reportClientEvent({
      type: "api_error",
      message: msg,
      requestId: res.headers.get("x-request-id") ?? undefined,
      data: { path, status: res.status },
    });
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
  /**
   * True when the same Mudrex API secret (fingerprint) is linked on more than
   * one RexAlgo user row. Shown as a dashboard security notice.
   */
  mudrexKeySharedAcrossAccounts?: boolean;
  isAdmin?: boolean;
  masterAccess?: MasterAccessStatus;
  telegramId?: string | null;
  telegramUsername?: string | null;
  telegramNotifyEnabled?: boolean;
  /**
   * `true` once the user has tapped `/start` on the RexAlgo bot at least once.
   * We only ship DMs to connected users — see `backend/src/lib/notifications.ts`.
   */
  telegramConnected?: boolean;
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

export type KillSwitchSummary = {
  subscriptionsStopped: number;
  rexAlgoOpenTradesFound: number;
  ordersCancelled: number;
  positionsClosed: number;
  failures: number;
  orderResults: Array<{
    orderId: string;
    status: "cancelled" | "failed";
    detail?: string;
  }>;
  positionResults: Array<{
    symbol: string;
    side: string;
    positionId: string;
    status: "closed" | "failed";
    detail?: string;
  }>;
};

export async function activateKillSwitch() {
  return apiFetch<{
    success: boolean;
    user: SessionUser;
    summary: KillSwitchSummary;
  }>("/api/account/kill-switch", { method: "POST" });
}

export type RexAlgoTradeActivity = {
  id: string;
  source: "manual" | "copy" | "tv";
  strategyId: string | null;
  orderId: string | null;
  positionId: string | null;
  symbol: string;
  side: string;
  quantity: string;
  entryPrice: string | null;
  exitPrice: string | null;
  pnl: string | null;
  notionalUsdt: string | null;
  status: "open" | "closed" | "cancelled";
  closedAt: string | null;
  createdAt: string;
};

export async function fetchRexAlgoTradeActivity() {
  return apiFetch<{ trades: RexAlgoTradeActivity[] }>(
    "/api/account/trade-activity"
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
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 401) return { user: null, sessionExpiresAt: null };
    throw new ApiError(
      data.error ? String(data.error) : res.statusText,
      res.status,
      data
    );
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
  contactPhone: string;
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

export async function requestMasterAccess(args: {
  note?: string;
  contactPhone: string;
}) {
  return apiFetch<{
    ok: boolean;
    status: MasterAccessStatus;
    requestId?: string;
    message?: string;
  }>("/api/master-access/request", {
    method: "POST",
    body: JSON.stringify({
      note: args.note?.trim() || undefined,
      contactPhone: args.contactPhone.trim(),
    }),
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
  contactPhone: string;
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

export async function deleteAdminMasterAccessRequest(id: string) {
  return apiFetch<{
    ok: boolean;
    deleted: { id: string; userId: string; status: string };
  }>(`/api/admin/master-access/${id}`, { method: "DELETE" });
}

export async function fetchAdminStrategySlotRequests(
  status: "pending" | "approved" | "rejected" | "all" = "pending"
) {
  const params = new URLSearchParams({ status });
  return apiFetch<{ requests: StrategySlotRequestRow[] }>(
    `/api/admin/strategy-slot-requests?${params.toString()}`
  );
}

export async function reviewAdminStrategySlotRequest(
  id: string,
  action: "approve" | "reject",
  note?: string
) {
  return apiFetch<{ ok: boolean; id: string; status: "approved" | "rejected" }>(
    `/api/admin/strategy-slot-requests/${id}`,
    { method: "POST", body: JSON.stringify({ action, note }) }
  );
}

export type StrategyReviewStatus = "pending" | "approved" | "rejected";

export type AdminStrategyRow = {
  id: string;
  name: string;
  type: "algo" | "copy_trading";
  symbol: string;
  isActive: boolean;
  status: StrategyReviewStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  creatorId: string;
  creatorName: string;
  creatorEmail: string | null;
  createdAt: string;
  subscriberCount: number;
  webhookEnabled: boolean;
};

export async function fetchAdminStrategies(
  type: "algo" | "copy_trading" | "all" = "all",
  status: StrategyReviewStatus | "all" = "all"
) {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (status !== "all") params.set("status", status);
  return apiFetch<{ strategies: AdminStrategyRow[] }>(
    `/api/admin/strategies${params.toString() ? `?${params}` : ""}`
  );
}

export async function reviewAdminStrategy(
  id: string,
  action: "approve" | "reject",
  reason?: string
) {
  return apiFetch<{
    ok: boolean;
    id: string;
    status: StrategyReviewStatus;
    reason?: string | null;
  }>(`/api/admin/strategies/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ action, reason }),
  });
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
  hasMudrexKey: boolean;
  telegramLinked: boolean;
  telegramUsername: string | null;
  strategyCount: number;
  approvedStrategyCount: number;
  subscriptionCount: number;
  tvWebhookCount: number;
  totalVolumeUsdt: string;
  masterStatus: string | null;
};

export async function fetchAdminUsers() {
  return apiFetch<{ users: AdminUserRow[] }>("/api/admin/users");
}

export type AdminUserDetail = {
  user: {
    id: string;
    email: string | null;
    displayName: string;
    authProvider: string;
    createdAt: string;
    hasMudrexKey: boolean;
    telegramLinked: boolean;
    telegramUsername: string | null;
    telegramNotifyEnabled: boolean;
  };
  strategies: Array<{
    id: string;
    name: string;
    type: "algo" | "copy_trading";
    symbol: string;
    isActive: boolean;
    status: StrategyReviewStatus;
    rejectionReason: string | null;
    subscriberCount: number;
    createdAt: string;
  }>;
  subscriptions: Array<{
    id: string;
    strategyId: string;
    marginPerTrade: string;
    isActive: boolean;
    createdAt: string;
    strategyName: string | null;
    strategyType: "algo" | "copy_trading" | null;
    strategyStatus: StrategyReviewStatus | null;
    strategySymbol: string | null;
    creatorId: string | null;
  }>;
  tvWebhooks: Array<{
    id: string;
    name: string;
    enabled: boolean;
    mode: "manual_trade" | "route_to_strategy";
    strategyId: string | null;
    maxMarginUsdt: number;
    lastDeliveryAt: string | null;
    createdAt: string;
  }>;
  recentTrades: Array<{
    id: string;
    symbol: string;
    side: string;
    quantity: string;
    entryPrice: string | null;
    source: "manual" | "copy" | "tv";
    notionalUsdt: string | null;
    status: string;
    strategyId: string | null;
    orderId: string | null;
    createdAt: string;
  }>;
  volume: {
    totalUsdt: string;
    bySource: Record<"manual" | "copy" | "tv", string>;
    countsBySource: Record<"manual" | "copy" | "tv", number>;
  };
  masterRequests: Array<{
    id: string;
    status: "pending" | "approved" | "rejected";
    note: string | null;
    contactPhone: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    createdAt: string;
  }>;
};

export async function fetchAdminUserDetail(id: string) {
  return apiFetch<AdminUserDetail>(`/api/admin/users/${id}`);
}

export type AdminAuditEntry = {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  createdAt: string;
};

export async function fetchAdminAudit() {
  return apiFetch<{ entries: AdminAuditEntry[] }>("/api/admin/audit");
}

// ─── Strategies ─────────────────────────────────────────────────────

/** Stored on algo strategies; drives simulation for that listing only. */
export type StrategyBacktestSpec =
  | {
      engine: "sma_cross";
      params: { fastPeriod: number; slowPeriod: number };
    }
  | {
      engine: "rule_builder_v1";
      params: {
        indicator: "sma" | "ema" | "rsi";
        period: number;
        comparator: "cross_above" | "cross_below" | "above" | "below";
        threshold: number;
        exitComparator?: "cross_above" | "cross_below" | "above" | "below";
        exitThreshold?: number;
      };
    };

export type ApiStrategy = {
  id: string;
  creatorId: string;
  creatorName: string;
  name: string;
  description: string;
  type: "copy_trading" | "algo";
  symbol: string;
  assetMode?: "single" | "multi";
  symbolsJson?: string | null;
  symbols?: string[];
  side: string;
  leverage: string;
  stoplossPct: number | null;
  takeprofitPct: number | null;
  riskLevel: "low" | "medium" | "high";
  timeframe: string | null;
  /** Raw JSON from API; parse with {@link parseStrategyBacktestSpec}. */
  backtestSpecJson?: string | null;
  isActive: boolean;
  /**
   * Admin review state. Public listing endpoints already filter to
   * `approved`, but studio listings return all states so the creator sees
   * pending / rejected rows too.
   */
  status?: StrategyReviewStatus;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
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
    if ((engine !== "sma_cross" && engine !== "rule_builder_v1") || !params || typeof params !== "object") return null;
    if (engine === "rule_builder_v1") {
      const p = params as Record<string, unknown>;
      return {
        engine: "rule_builder_v1",
        params: {
          indicator: p.indicator === "ema" || p.indicator === "rsi" ? p.indicator : "sma",
          period: Math.max(2, Number(p.period) || 20),
          comparator:
            p.comparator === "cross_below" || p.comparator === "above" || p.comparator === "below"
              ? p.comparator
              : "cross_above",
          threshold: Number(p.threshold) || 0,
          exitComparator:
            p.exitComparator === "cross_above" ||
            p.exitComparator === "cross_below" ||
            p.exitComparator === "above" ||
            p.exitComparator === "below"
              ? p.exitComparator
              : "cross_below",
          exitThreshold: Number(p.exitThreshold) || 0,
        },
      };
    }
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
    backtestSpec?: StrategyBacktestSpec;
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

// ─── Master dashboard ────────────────────────────────────────────────

export type MasterDashboardSummary = {
  totalStrategies: number;
  activeApprovedStrategies: number;
  activeSubscribers: number;
  totalVolumeUsdt: string;
  recentSignals24h: number;
  recentMirrorErrors24h: number;
};

export type MasterDashboardStrategy = {
  id: string;
  name: string;
  type: "copy_trading" | "algo";
  symbol: string;
  status: StrategyReviewStatus;
  isActive: boolean;
  createdAt: string | null;
  activeSubscribers: number;
  totalVolumeUsdt: string;
  totalSignals: number;
  signals24h: number;
  mirrorErrors24h: number;
  lastSignalAt: string | null;
  webhookEnabled: boolean;
  webhookLastDeliveryAt: string | null;
};

export type MasterDashboardActivity = {
  signalId: string;
  strategyId: string;
  strategyName: string;
  strategyType: "copy_trading" | "algo";
  strategySymbol: string;
  receivedAt: string | null;
  idempotencyKey: string;
  action: string | null;
  symbol: string | null;
  side: string | null;
  triggerType: string | null;
  processed: number;
  ok: number;
  errors: number;
};

export type MasterDashboardPayload = {
  summary: MasterDashboardSummary;
  strategies: MasterDashboardStrategy[];
  recentActivity: MasterDashboardActivity[];
  telegram: {
    connected: boolean;
    notifyEnabled: boolean;
    username: string | null;
  };
};

export async function fetchMasterDashboard() {
  return apiFetch<MasterDashboardPayload>("/api/master/dashboard");
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
  status: StrategyReviewStatus;
  assetMode?: "single" | "multi";
  symbolsJson?: string | null;
  symbols?: string[];
  rejectionReason: string | null;
  reviewedAt: string | null;
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

export type StrategySlotInfo = { used: number; limit: number };

export type StrategySlotRequestRow = {
  id: string;
  userId: string;
  strategyType: "algo" | "copy_trading";
  requestedSlots: number;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
};

export type MudrexAsset = {
  asset_id: string;
  symbol: string;
  base_currency: string;
  quote_currency: string;
  is_active: boolean;
  price?: string;
};

export async function fetchMudrexAssets(symbol?: string) {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return apiFetch<{ assets?: MudrexAsset[]; asset?: MudrexAsset }>(
    `/api/mudrex/assets${q}`
  );
}

export async function fetchCopyStudioStrategies() {
  return apiFetch<{
    strategies: StudioStrategyRow[];
    publicBaseUrl: string | null;
    slots: StrategySlotInfo;
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
  summary?: {
    action: unknown;
    symbol: unknown;
    side: unknown;
    triggerType: unknown;
  } | null;
  mirror: { ok: number; err: number; lastError?: string | null };
};

export async function fetchCopyStrategySignals(strategyId: string) {
  return apiFetch<{ signals: CopySignalRow[] }>(
    `/api/copy-trading/studio/strategies/${strategyId}/signals`
  );
}

export type CopyStudioStrategyPatch = {
  name?: string;
  description?: string;
  symbol?: string;
  side?: "LONG" | "SHORT" | "BOTH";
  leverage?: string;
  riskLevel?: "low" | "medium" | "high";
  timeframe?: string;
  stoplossPct?: number | null;
  takeprofitPct?: number | null;
};

export async function updateCopyStudioStrategy(
  strategyId: string,
  patch: CopyStudioStrategyPatch
) {
  return apiFetch<{ strategy: StudioStrategyRow }>(
    `/api/copy-trading/studio/strategies/${strategyId}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );
}

export async function deleteCopyStudioStrategy(strategyId: string) {
  return apiFetch<{ ok: boolean; id: string }>(
    `/api/copy-trading/studio/strategies/${strategyId}`,
    { method: "DELETE" }
  );
}

export async function resubmitCopyStudioStrategy(strategyId: string) {
  return apiFetch<{ ok: boolean; strategy: StudioStrategyRow }>(
    `/api/copy-trading/studio/strategies/${strategyId}/resubmit`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

// ─── Marketplace — Strategy studio (algo) ───────────────────────────

export async function fetchMarketplaceStudioStrategies() {
  return apiFetch<{
    strategies: StudioStrategyRow[];
    publicBaseUrl: string | null;
    slots: StrategySlotInfo;
  }>("/api/marketplace/studio/strategies");
}

export async function fetchMarketplaceSlotRequests() {
  return apiFetch<{ requests: StrategySlotRequestRow[] }>(
    "/api/marketplace/studio/slot-requests"
  );
}

export async function requestMarketplaceSlots(body: {
  requestedSlots: number;
  note?: string;
}) {
  return apiFetch<{ request: StrategySlotRequestRow }>(
    "/api/marketplace/studio/slot-requests",
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function createMarketplaceStudioStrategy(body: {
  name: string;
  description: string;
  symbol: string;
  assetMode?: "single" | "multi";
  symbols?: string[];
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

export type MarketplaceStudioStrategyPatch = CopyStudioStrategyPatch & {
  assetMode?: "single" | "multi";
  symbols?: string[];
  backtestSpec?: StrategyBacktestSpec;
};

export async function updateMarketplaceStudioStrategy(
  strategyId: string,
  patch: MarketplaceStudioStrategyPatch
) {
  return apiFetch<{ strategy: StudioStrategyRow }>(
    `/api/marketplace/studio/strategies/${strategyId}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );
}

export async function deleteMarketplaceStudioStrategy(strategyId: string) {
  return apiFetch<{ ok: boolean; id: string }>(
    `/api/marketplace/studio/strategies/${strategyId}`,
    { method: "DELETE" }
  );
}

export async function resubmitMarketplaceStudioStrategy(strategyId: string) {
  return apiFetch<{ ok: boolean; strategy: StudioStrategyRow }>(
    `/api/marketplace/studio/strategies/${strategyId}/resubmit`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function subscribe(
  strategyId: string,
  marginPerTrade: string,
  marginCurrency: MarginCurrency = "USDT"
) {
  return apiFetch<{ success: boolean; subscriptionId: string }>(
    "/api/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({ strategyId, marginPerTrade, marginCurrency }),
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

/** Body for `POST /api/mudrex/orders` (place order — not cancel). */
export type PostMudrexPlaceOrderBody = {
  symbol: string;
  side: string;
  quantity: string;
  leverage?: string;
  triggerType?: string;
  price?: string;
  stoplosPrice?: string;
  takeprofitPrice?: string;
  reduceOnly?: boolean;
};

/**
 * Places a futures order via RexAlgo. Sends a fresh `Idempotency-Key` per call
 * so double-submit / retry replays the same result for ~60s (server-side dedupe).
 */
export async function postMudrexPlaceOrder(body: PostMudrexPlaceOrderBody) {
  return apiFetch<{ order: Record<string, unknown> }>("/api/mudrex/orders", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
}

export async function postMudrexCancelOrder(orderId: string) {
  return apiFetch<{ success: boolean }>("/api/mudrex/orders", {
    method: "POST",
    body: JSON.stringify({ action: "cancel", orderId }),
  });
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
  /**
   * The currency the `marginPerTrade` is denominated in. Server only persists
   * USDT today; INR is reserved for the upcoming Mudrex INR futures launch.
   * Optional on the wire so older clients/responses default to USDT.
   */
  marginCurrency?: MarginCurrency;
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
  marginPerTrade: string,
  marginCurrency: MarginCurrency = "USDT"
) {
  return apiFetch<{ success: boolean; marginPerTrade: string }>(
    `/api/subscriptions/${subscriptionId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ marginPerTrade, marginCurrency }),
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

/** @deprecated Login Widget flow — kept for backward compatibility. Use the bot-first flow (`startTelegramBotLogin` + `pollTelegramBotLogin`). */
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

// ── Bot-first Telegram login ────────────────────────────────────────
//
// Flow:
//   1. `startTelegramBotLogin({ returnPath })` → the server creates a token
//      and returns the `t.me/<bot>?start=rexalgo_<token>` deep link.
//   2. Frontend opens `deepLink` (new tab / same tab — whichever the
//      component chooses) so the user lands inside Telegram.
//   3. Frontend polls `pollTelegramBotLogin(token)` every ~1.5s until the
//      response is `status: "ok"` (user tapped START) or `"expired"`.

export type TelegramStartLoginResponse = {
  ok: true;
  token: string;
  /** `https://t.me/<botUsername>?start=rexalgo_<token>` */
  deepLink: string;
  botUsername: string;
  expiresAt: string;
  expiresInMs: number;
  mode: "login" | "link";
};

/** Session-backed; call before `startTelegramBotLogin` when linking Telegram to an existing account. */
export async function fetchTelegramLinkIntent() {
  return apiFetch<{ linkToken: string }>("/api/auth/telegram/link-intent");
}

export async function startTelegramBotLogin(opts?: {
  returnPath?: string | null;
  /** Proves which user to link when the session cookie is not sent on POST (e.g. Safari). */
  linkToken?: string | null;
}) {
  return apiFetch<TelegramStartLoginResponse>("/api/auth/telegram/start", {
    method: "POST",
    body: JSON.stringify({
      returnPath: opts?.returnPath ?? null,
      linkToken: opts?.linkToken ?? null,
    }),
  });
}

export type TelegramPollResponse =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "used" }
  | {
      status: "ok";
      linked: boolean;
      user: SessionUser;
      returnPath: string | null;
    };

export async function pollTelegramBotLogin(token: string) {
  const res = await fetch(
    `/api/auth/telegram/poll?token=${encodeURIComponent(token)}`,
    { credentials: "include", cache: "no-store" }
  );
  const data = (await res.json().catch(() => ({}))) as TelegramPollResponse | { error?: string };
  if (!res.ok) {
    throw new ApiError(
      "error" in data && data.error ? String(data.error) : res.statusText,
      res.status,
      data
    );
  }
  return data as TelegramPollResponse;
}

// ─── TradingView webhooks (API path: /api/tv-webhooks) ───────────────

export type TvWebhookMode = "manual_trade" | "route_to_strategy";

export type TvWebhookRow = {
  id: string;
  name: string;
  enabled: boolean;
  mode: TvWebhookMode;
  strategyId: string | null;
  maxMarginUsdt: number;
  defaultLeverage: number;
  defaultRiskPct: number;
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
  defaultLeverage?: number;
  defaultRiskPct?: number;
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
    defaultLeverage: number;
    defaultRiskPct: number;
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
