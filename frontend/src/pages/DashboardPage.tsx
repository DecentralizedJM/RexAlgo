import { useCallback, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import PerformanceChart from "@/components/PerformanceChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BarChart3,
  Users,
  Wallet,
  History,
  LineChart,
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  KeyRound,
  ExternalLink,
  Shield,
  Lock,
  RefreshCw,
} from "lucide-react";
import {
  fetchWallet,
  fetchPositions,
  fetchPositionHistory,
  fetchRexAlgoTradeActivity,
  fetchSubscriptions,
  linkMudrexKey,
  ApiError,
  getApiErrorCode,
  isMudrexCredentialError,
  type ApiPosition,
  type RexAlgoTradeActivity,
} from "@/lib/api";
import { formatPair } from "@/lib/format";
import { useRequireAuth } from "@/hooks/useAuth";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";
import { futuresAvailableUsdt } from "@/lib/walletFunding";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { MUDREX_PRO_TRADING_URL } from "@/lib/externalLinks";
import { MUDREX_KEY_PROBE_QUERY_KEY } from "@/lib/queryKeys";
import { toast } from "sonner";
import { refreshAppData } from "@/lib/refreshAppData";

/** Cumulative realized P&L from Mudrex position history (one API page). */
function buildRealizedPnlCurve(positions: ApiPosition[]): { date: string; value: number }[] {
  if (!positions.length) return [];
  const indexed = positions.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => {
    const ta = a.p.closed_at || a.p.updated_at || a.p.created_at || "";
    const tb = b.p.closed_at || b.p.updated_at || b.p.created_at || "";
    if (ta && tb) return ta.localeCompare(tb);
    return a.i - b.i;
  });
  let cum = 0;
  return indexed.map(({ p }, n) => {
    cum += parseFloat(p.realized_pnl ?? "0");
    const dateLabel =
      (p.closed_at && p.closed_at.slice(0, 10)) ||
      (p.updated_at && p.updated_at.slice(0, 10)) ||
      (p.created_at && p.created_at.slice(0, 10)) ||
      `#${n + 1}`;
    return { date: dateLabel, value: cum };
  });
}

function sortClosedHistoryDescending(positions: ApiPosition[]): ApiPosition[] {
  return [...positions].sort((a, b) => {
    const ta = a.closed_at || a.updated_at || a.created_at || "";
    const tb = b.closed_at || b.updated_at || b.created_at || "";
    return tb.localeCompare(ta);
  });
}

function formatLeverageX(leverage: string | undefined): string {
  const lev = leverage?.trim();
  return lev ? `${lev}×` : "—";
}

type FetchIssue = { label: string; err: unknown };

function formatFetchIssueLine(issue: FetchIssue): string {
  const { label, err } = issue;
  if (err instanceof ApiError) {
    const code = getApiErrorCode(err);
    const suffix = code ? ` [${code}]` : "";
    return `${label}: ${err.message}${suffix} (HTTP ${err.status})`;
  }
  if (err instanceof Error) return `${label}: ${err.message}`;
  return `${label}: unknown error`;
}

function mudrexUpstreamHint(issues: FetchIssue[]): string | null {
  for (const { err } of issues) {
    if (isMudrexCredentialError(err)) {
      return "Mudrex rejected the API secret we have on file (often after ~90 days). Open Sign in and paste a new key from Mudrex Pro Trading.";
    }
    if (err instanceof ApiError && getApiErrorCode(err) === "MUDREX_RATE_LIMIT") {
      return "Mudrex rate-limited these requests. Wait a minute, then use Retry or the dashboard Refresh button.";
    }
    if (err instanceof ApiError && getApiErrorCode(err) === "MUDREX_UNAVAILABLE") {
      return "Mudrex returned an overload or maintenance response. Retry shortly.";
    }
  }
  for (const { label, err } of issues) {
    if (label === "Subscriptions (RexAlgo DB)" && err instanceof ApiError && err.status >= 500) {
      return "The subscriptions call uses your RexAlgo database on the API host (not Mudrex). If Postgres was down or DATABASE_URL changed, fix Railway env vars and redeploy the API.";
    }
  }
  return null;
}

function formatClosedWhen(p: ApiPosition): string {
  const raw = p.closed_at || p.updated_at || p.created_at;
  if (!raw) return "N/A";
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  } catch {
    /* fall through */
  }
  return raw.length >= 10 ? raw.slice(0, 16).replace("T", " ") : raw;
}

function formatSessionExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type PositionScope = "all" | "rexalgo";

function positionKey(symbol: string, side: string): string {
  return `${symbol.trim().toUpperCase()}:${side.trim().toUpperCase()}`;
}

function ScopePills({
  value,
  onChange,
}: {
  value: PositionScope;
  onChange: (value: PositionScope) => void;
}) {
  const options: Array<{ value: PositionScope; label: string }> = [
    { value: "all", label: "All Mudrex" },
    { value: "rexalgo", label: "RexAlgo" },
  ];

  return (
    <div className="inline-flex rounded-full border border-primary/25 bg-background/80 p-1 shadow-sm">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={active}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function isRexAlgoOpenPosition(
  position: ApiPosition,
  trades: RexAlgoTradeActivity[]
): boolean {
  const exactIds = new Set(
    trades
      .map((trade) => trade.positionId)
      .filter((positionId): positionId is string => Boolean(positionId))
  );
  if (position.position_id && exactIds.has(position.position_id)) return true;

  const openKeys = new Set(
    trades
      .filter((trade) => trade.status === "open")
      .map((trade) => positionKey(trade.symbol, trade.side))
  );
  return openKeys.has(positionKey(position.symbol, position.side));
}

function isRexAlgoHistoryPosition(
  position: ApiPosition,
  trades: RexAlgoTradeActivity[]
): boolean {
  const exactIds = new Set(
    trades
      .map((trade) => trade.positionId)
      .filter((positionId): positionId is string => Boolean(positionId))
  );
  if (position.position_id && exactIds.has(position.position_id)) return true;

  const closedKeys = new Set(
    trades
      .filter((trade) => trade.status === "closed")
      .map((trade) => positionKey(trade.symbol, trade.side))
  );
  return closedKeys.has(positionKey(position.symbol, position.side));
}

function MudrexBrandMark() {
  return (
    <a
      href={MUDREX_PRO_TRADING_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group mx-auto mb-6 flex w-full max-w-[14rem] flex-col items-center rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 to-primary/5 px-5 py-4 shadow-sm ring-1 ring-primary/10 transition-colors hover:border-primary/40 hover:ring-primary/20"
    >
      <img
        src="/mudrex-logo.png"
        alt="Mudrex"
        className="h-12 w-auto object-contain"
        loading="lazy"
      />
    </a>
  );
}

function ConnectMudrexCard() {
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;
    setLinking(true);
    setError("");
    try {
      const result = await linkMudrexKey(secret.trim());
      queryClient.setQueryData(["session", "me"], {
        user: result.user,
        sessionExpiresAt: null,
      });
      await queryClient.refetchQueries({ queryKey: ["session", "me"] });
      // Ensure the new HttpOnly cookie is in effect, then pull Mudrex data immediately
      // (invalidate alone can race the first fetch before the browser attaches the cookie).
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["wallet", "futures"] }),
        queryClient.refetchQueries({ queryKey: ["positions"] }),
        queryClient.refetchQueries({ queryKey: ["subscriptions"] }),
        queryClient.refetchQueries({ queryKey: ["positions", "history"] }),
        queryClient.refetchQueries({ queryKey: MUDREX_KEY_PROBE_QUERY_KEY }),
      ]);
      toast.success("Mudrex connected");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to link API key. Check the secret and try again."
      );
    } finally {
      setLinking(false);
    }
  };

  const encryptionPoints = [
    {
      icon: Shield,
      text: "All data is encrypted in transit between your browser, RexAlgo, and Mudrex.",
    },
    {
      icon: Lock,
      text: "Your API secret is securely encrypted and stored. It is never logged, exposed, or displayed again after you save it.",
    },
    {
      icon: KeyRound,
      text: "Your secret is used exclusively to sign Mudrex API requests on your behalf and is never shared with third parties.",
    },
  ];

  return (
    <div className="flex w-full flex-col items-center py-6 md:py-12">
      <div className="w-full max-w-md animate-fade-up">
        <div className="rounded-2xl border border-border/80 bg-card/90 p-8 shadow-[0_20px_50px_-24px_hsl(var(--primary)/0.25)] backdrop-blur-xl dark:bg-card/70 dark:shadow-[0_24px_60px_-20px_hsl(0_0%_0%/0.45)]">
          <MudrexBrandMark />

          <h2 className="text-center text-lg font-semibold tracking-tight">Connect Mudrex</h2>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Paste your Mudrex API secret to unlock your dashboard.
          </p>

          <ul className="mt-6 space-y-3 border-y border-border/60 py-5">
            {encryptionPoints.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-left text-xs leading-relaxed text-muted-foreground">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>

          <form onSubmit={handleLink} className="mt-6 space-y-3">
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setError("");
                }}
                placeholder="Mudrex API secret"
                className="h-11 bg-secondary/50 pr-10 font-mono text-sm border-border"
                disabled={linking}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showSecret ? "Hide secret" : "Show secret"}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error ? <p className="text-sm text-loss">{error}</p> : null}
            <Button
              type="submit"
              variant="hero"
              className="w-full"
              disabled={!secret.trim() || linking}
            >
              {linking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Linking…
                </>
              ) : (
                "Connect Mudrex"
              )}
            </Button>
            <Button variant="outline" className="w-full" asChild>
              <a href={MUDREX_PRO_TRADING_URL} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open Mudrex for your API Secret
              </a>
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const authQ = useRequireAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pnlScope, setPnlScope] = useState<PositionScope>("all");
  const [openScope, setOpenScope] = useState<PositionScope>("all");
  const [historyScope, setHistoryScope] = useState<PositionScope>("all");
  const sessionAuthed = authQ.authed;
  const user = authQ.data?.user;
  const hasMudrexKey = user?.hasMudrexKey ?? false;
  const mudrexKeySharedAcrossAccounts = user?.mudrexKeySharedAcrossAccounts === true;
  const isAdmin = user?.isAdmin === true;

  const walletQ = useQuery({
    queryKey: ["wallet", "futures"],
    queryFn: () => fetchWallet({ futuresOnly: true }),
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: 2,
    retryDelay: (n) => Math.min(1500 * (n + 1), 5000),
  });
  const posQ = useQuery({
    queryKey: ["positions"],
    queryFn: fetchPositions,
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: 2,
    retryDelay: (n) => Math.min(1500 * (n + 1), 5000),
  });
  const subQ = useQuery({
    queryKey: ["subscriptions"],
    queryFn: fetchSubscriptions,
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: 2,
    retryDelay: (n) => Math.min(1500 * (n + 1), 5000),
  });
  const historyQ = useQuery({
    queryKey: ["positions", "history"],
    queryFn: fetchPositionHistory,
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: 2,
    retryDelay: (n) => Math.min(1500 * (n + 1), 5000),
  });
  const activityQ = useQuery({
    queryKey: ["rexalgo-trade-activity"],
    queryFn: fetchRexAlgoTradeActivity,
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: 2,
    retryDelay: (n) => Math.min(1500 * (n + 1), 5000),
  });

  const refreshDashboardData = useCallback(
    async (showErrorToast = false) => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      setRefreshing(true);
      try {
        await refreshAppData(queryClient);
      } catch {
        if (showErrorToast) toast.error("Could not refresh dashboard");
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    },
    [queryClient]
  );

  useEffect(() => {
    const err = walletQ.error || posQ.error || subQ.error || historyQ.error;
    if (!(err instanceof ApiError) || err.status !== 401) return;
    // Session missing / expired → sign in. Mudrex key invalid → stay here; banner explains reconnect.
    if (isMudrexCredentialError(err)) return;
    navigate("/auth", { replace: true });
  }, [walletQ.error, posQ.error, subQ.error, historyQ.error, navigate]);

  useEffect(() => {
    if (!sessionAuthed || !hasMudrexKey) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshDashboardData();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [hasMudrexKey, refreshDashboardData, sessionAuthed]);

  /** Each Mudrex endpoint can lag independently — do not gate every stat on the slowest query. */
  const walletStatPending = walletQ.isPending && walletQ.data === undefined;
  const subsStatPending = subQ.isPending && subQ.data === undefined;
  const posStatPending = posQ.isPending && posQ.data === undefined;
  const openPositionsLoading = posQ.isPending && posQ.data === undefined;
  const futures = walletQ.data?.futures;
  const positions = useMemo(() => posQ.data?.positions ?? [], [posQ.data?.positions]);
  const rexAlgoTrades = useMemo(
    () => activityQ.data?.trades ?? [],
    [activityQ.data?.trades]
  );
  const subs = subQ.data?.subscriptions?.filter((s) => s.isActive) ?? [];
  const futAvailable = futuresAvailableUsdt(walletQ.data);
  const underfundedSubs = subs.filter((s) => {
    const m = parseFloat(s.marginPerTrade ?? "0");
    return Number.isFinite(m) && m > 0 && futAvailable < m;
  });

  const closedHistorySorted = useMemo(
    () => sortClosedHistoryDescending(historyQ.data?.positions ?? []),
    [historyQ.data?.positions]
  );
  const rexAlgoOpenPositions = useMemo(
    () => positions.filter((position) => isRexAlgoOpenPosition(position, rexAlgoTrades)),
    [positions, rexAlgoTrades]
  );
  const rexAlgoHistorySorted = useMemo(
    () =>
      closedHistorySorted.filter((position) =>
        isRexAlgoHistoryPosition(position, rexAlgoTrades)
      ),
    [closedHistorySorted, rexAlgoTrades]
  );
  const displayedOpenPositions =
    openScope === "rexalgo" ? rexAlgoOpenPositions : positions;
  const displayedHistory =
    historyScope === "rexalgo" ? rexAlgoHistorySorted : closedHistorySorted;
  const chartPositions =
    pnlScope === "rexalgo" ? rexAlgoHistorySorted : historyQ.data?.positions ?? [];

  const fetchIssues: FetchIssue[] = [
    ...(walletQ.error ? [{ label: "Futures wallet (Mudrex)", err: walletQ.error }] : []),
    ...(posQ.error ? [{ label: "Open positions (Mudrex)", err: posQ.error }] : []),
    ...(subQ.error ? [{ label: "Subscriptions (RexAlgo DB)", err: subQ.error }] : []),
    ...(historyQ.error ? [{ label: "Position history (Mudrex)", err: historyQ.error }] : []),
  ];
  const fetchHint = mudrexUpstreamHint(fetchIssues);

  const anyFetchError =
    hasMudrexKey && (walletQ.isError || posQ.isError || subQ.isError || historyQ.isError);
  const mudrexKeyRejected =
    anyFetchError &&
    [walletQ.error, posQ.error, subQ.error, historyQ.error].some(
      (e) => e != null && isMudrexCredentialError(e)
    );

  /** Non-admins: do not show misleading $0 when the request failed — use the same “loading” ellipsis. */
  const walletUserHold = !isAdmin && !mudrexKeyRejected && walletQ.isError;
  const subsUserHold = !isAdmin && !mudrexKeyRejected && subQ.isError;
  const posUserHold = !isAdmin && !mudrexKeyRejected && posQ.isError;
  const openPositionsSectionLoading = openPositionsLoading || posUserHold;

  const retryDashboardQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["wallet", "futures"] });
    void queryClient.invalidateQueries({ queryKey: ["positions"] });
    void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    void queryClient.invalidateQueries({ queryKey: ["positions", "history"] });
  };

  const futBal = parseFloat(futures?.balance ?? "0");
  const lockedMargin = parseFloat(futures?.locked_amount ?? "0");
  const chartData = buildRealizedPnlCurve(chartPositions);

  if (!authQ.authResolved) {
    return <AuthGateSplash />;
  }
  if (!authQ.data?.user) {
    return null;
  }

  const statCards = [
    {
      label: "Futures Wallet",
      pending: walletStatPending || walletUserHold,
      value: `$${futBal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: Wallet,
    },
    {
      label: "Locked margin",
      pending: walletStatPending || walletUserHold,
      value: `$${lockedMargin.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: Lock,
    },
    {
      label: "Open positions",
      pending: posStatPending || posUserHold,
      value: positions.length.toString(),
      icon: Users,
    },
    {
      label: "Active subscriptions",
      pending: subsStatPending || subsUserHold,
      value: subs.length.toString(),
      icon: BarChart3,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-fade-up">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">Dashboard</h1>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/30 px-3 py-1 text-xs text-muted-foreground">
                {hasMudrexKey && mudrexKeySharedAcrossAccounts ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label="Mudrex API key security notice — open details"
                      >
                        <AlertTriangle
                          className="h-3.5 w-3.5 shrink-0 text-warning animate-alert-attention"
                          aria-hidden
                        />
                        <span className="text-warning font-medium text-foreground/90">
                          Mudrex key — review
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 text-sm" align="start">
                      <p className="font-semibold text-foreground leading-snug mb-2">
                        This API key is on more than one RexAlgo account
                      </p>
                      <p className="text-muted-foreground leading-relaxed">
                        The same Mudrex secret is linked to another RexAlgo sign-in. If you did not set that up,
                        revoke this key in Mudrex immediately, create a new API secret, and reconnect only on the
                        account you trust.
                      </p>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <>
                    <span
                      className={`h-2 w-2 rounded-full ${hasMudrexKey ? "bg-profit" : "bg-warning"}`}
                      aria-hidden
                    />
                    {hasMudrexKey ? "Mudrex Key Active" : "Mudrex key not linked"}
                  </>
                )}
              </div>
              {hasMudrexKey && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={refreshing}
                  onClick={() => void refreshDashboardData(true)}
                  aria-label="Refresh dashboard data"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {hasMudrexKey ? (
                <>
                  Balances and positions from Mudrex. Auto-refreshes every 15 seconds while this tab is active.
                </>
              ) : (
                <>Connect your Mudrex API key below to load balances, positions, and trading data.</>
              )}
            </p>
            {hasMudrexKey && formatSessionExpiry(authQ.data?.sessionExpiresAt) && (
              <p className="text-xs text-muted-foreground mt-1">
                Browser session until{" "}
                <span className="text-foreground font-medium">
                  {formatSessionExpiry(authQ.data?.sessionExpiresAt)}
                </span>
                . Mudrex may reject the API key sooner (about 90 days). If this happens, reconnect at Sign in.
              </p>
            )}
          </div>
          {(hasMudrexKey || (user && !user.telegramId)) && (
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 shrink-0">
              {user && !user.telegramId && (
                <TelegramLoginButton
                  mode="link"
                  layout="inline"
                  afterAuthReturnPath="/dashboard"
                  onLinked={() => {
                    void queryClient.refetchQueries({ queryKey: ["session", "me"] });
                    toast.success("Telegram connected. You will get alerts here.");
                  }}
                />
              )}
            </div>
          )}
        </div>

        {!hasMudrexKey && <ConnectMudrexCard />}

        {isAdmin && (
          <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-up">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Admin dashboard</span> — approve Master studio
              requests, list or delete strategies, view users.
            </p>
            <Button variant="outline" size="sm" className="shrink-0" asChild>
              <Link to="/admin">Open</Link>
            </Button>
          </div>
        )}

        {hasMudrexKey && anyFetchError && isAdmin && (
          <div className="mb-6 rounded-xl border border-loss/30 bg-loss/10 p-4 text-sm">
            <p className="font-medium text-loss">Some dashboard data failed to load (admin diagnostics)</p>
            {fetchHint && (
              <p className="mt-2 text-xs text-foreground/90 leading-relaxed">{fetchHint}</p>
            )}
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground font-mono break-words list-disc pl-4">
              {fetchIssues.map((issue) => (
                <li key={issue.label}>{formatFetchIssueLine(issue)}</li>
              ))}
            </ul>
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={retryDashboardQueries}>
              Retry all
            </Button>
          </div>
        )}

        {hasMudrexKey && anyFetchError && !isAdmin && mudrexKeyRejected && (
          <div className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-center animate-fade-up">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning/20">
              <KeyRound className="h-6 w-6 text-warning" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-semibold text-foreground">Mudrex could not verify your API key</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your key may have expired or been rotated in the Mudrex app. Open Sign in and paste a fresh API
                secret — your RexAlgo profile and strategies stay the same.
              </p>
              <Button variant="default" size="sm" className="mt-1 w-full sm:w-auto" asChild>
                <Link to="/auth">Go to Sign in</Link>
              </Button>
            </div>
          </div>
        )}

        {hasMudrexKey && anyFetchError && !isAdmin && !mudrexKeyRejected && (
          <div className="mb-6 rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] via-background to-background p-5 sm:p-6 shadow-sm animate-fade-up">
            <div className="flex flex-col sm:flex-row gap-5 sm:items-start">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
                <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-base font-semibold text-foreground tracking-tight">Syncing your trading data</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We are connecting to Mudrex and your RexAlgo account to load your wallet, subscriptions, and
                  positions. This usually finishes within a few seconds.
                </p>
                <p className="text-xs text-muted-foreground/90 leading-relaxed">
                  If numbers do not appear after a short wait, use the dashboard{" "}
                  <span className="font-medium text-foreground">Refresh</span> button, or try again in a moment.
                </p>
                <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={retryDashboardQueries}>
                  Try again
                </Button>
              </div>
            </div>
          </div>
        )}

        {hasMudrexKey && underfundedSubs.length > 0 && walletQ.data && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3 text-sm animate-fade-up">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-warning">Futures balance may be too low</p>
              <p className="text-muted-foreground text-xs mt-1">
                {underfundedSubs.length} active{" "}
                {underfundedSubs.length === 1 ? "subscription needs" : "subscriptions need"} more futures
                margin (~${futAvailable.toFixed(2)} free). Add USDT on Mudrex or lower margin in{" "}
                <Link to="/subscriptions" className="text-primary font-medium hover:underline">
                  Subscriptions
                </Link>
                .
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0 border-warning/40">
              <Link to="/subscriptions">Manage</Link>
            </Button>
          </div>
        )}

        {!hasMudrexKey ? null : (
        <>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {statCards.map((s, i) => {
            const card = (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <s.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-xl font-mono font-bold">
                    {s.pending ? "…" : s.value}
                  </p>
                  {s.label === "Active subscriptions" && (
                    <p className="text-[10px] text-primary mt-0.5">Click to manage</p>
                  )}
                </div>
              </div>
            );
            const shellClass =
              "glass rounded-xl p-5 animate-fade-up transition-colors" +
              (s.label === "Active subscriptions"
                ? " cursor-pointer hover:bg-secondary/40 hover:ring-1 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                : "");
            if (s.label === "Active subscriptions") {
              return (
                <Link
                  key={s.label}
                  to="/subscriptions"
                  className={shellClass}
                  style={{ animationDelay: `${(i + 2) * 100}ms` }}
                >
                  {card}
                </Link>
              );
            }
            return (
              <div
                key={s.label}
                className={shellClass}
                style={{ animationDelay: `${(i + 2) * 100}ms` }}
              >
                {card}
              </div>
            );
          })}
        </div>

        {/* Performance chart */}
        <div className="glass rounded-xl p-6 mb-8 animate-fade-up-delay-3">
          <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-semibold mb-1 flex items-center gap-2">
                <LineChart className="w-4 h-4 text-primary" />
                Realized P&amp;L (closed positions)
              </h2>
              <p className="text-xs text-muted-foreground">
                {pnlScope === "rexalgo"
                  ? "RexAlgo mode tracks trades placed through RexAlgo. Older trades before exact position-id attribution may be incomplete."
                  : "From Mudrex closed-trade history (latest page). For taxes, use Mudrex statements."}
              </p>
            </div>
            <ScopePills value={pnlScope} onChange={setPnlScope} />
          </div>
          {historyQ.isPending || (pnlScope === "rexalgo" && activityQ.isPending) ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Loading history from Mudrex…</p>
          ) : historyQ.isError && !isAdmin ? (
            <p className="text-sm text-muted-foreground py-12 text-center leading-relaxed max-w-md mx-auto">
              Performance history will show here once your data finishes syncing. Use the dashboard{" "}
              <span className="font-medium text-foreground">Refresh</span> button or try again in a moment.
            </p>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              {pnlScope === "rexalgo"
                ? "No RexAlgo closed P&L matched this history window yet."
                : "No closed P&L in this window yet. Open P&L is above."}
            </p>
          ) : (
            <PerformanceChart data={chartData} valueLabel="Cumulative realized P&amp;L" />
          )}
        </div>

        {/* Below chart: open positions + position history */}
        <div className="glass rounded-xl p-6 animate-fade-up-delay-4 space-y-10">
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold mb-1 flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Open positions
                </h2>
                <p className="text-xs text-muted-foreground">
                  {openScope === "rexalgo"
                    ? "RexAlgo mode shows open positions matched to trades placed through RexAlgo."
                    : "Open futures on your Mudrex account."}
                </p>
              </div>
              <ScopePills value={openScope} onChange={setOpenScope} />
            </div>
            {openPositionsSectionLoading || (openScope === "rexalgo" && activityQ.isPending) ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
            ) : displayedOpenPositions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border/60 bg-secondary/20">
                {openScope === "rexalgo"
                  ? "No open RexAlgo positions matched your current Mudrex positions."
                  : "No open positions. Fund futures and trade on Mudrex, or subscribe to a strategy."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs border-b border-border bg-secondary/30">
                      <th className="text-left py-3 px-3 font-medium">Pair</th>
                      <th className="text-left py-3 px-3 font-medium">Side</th>
                      <th className="text-right py-3 px-3 font-medium">Qty</th>
                      <th className="text-right py-3 px-3 font-medium">Lev.</th>
                      <th className="text-right py-3 px-3 font-medium">Entry</th>
                      <th className="text-right py-3 px-3 font-medium">Mark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedOpenPositions.map((p) => {
                      const entry = parseFloat(p.entry_price ?? "0");
                      const mark = parseFloat(p.mark_price ?? "0");
                      return (
                        <tr
                          key={p.position_id}
                          className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                        >
                          <td className="py-3 px-3 font-medium">{formatPair(p.symbol)}</td>
                          <td className="py-3 px-3">
                            <span
                              className={`text-xs font-medium px-2 py-1 rounded ${
                                p.side === "LONG"
                                  ? "bg-profit/10 text-profit"
                                  : "bg-loss/10 text-loss"
                              }`}
                            >
                              {p.side}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono">{p.quantity}</td>
                          <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                            {formatLeverageX(p.leverage)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                            ${entry.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-3 text-right font-mono">
                            ${mark.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border-t border-border/60 pt-8">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold mb-1 flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" />
                  Position history
                </h2>
                <p className="text-xs text-muted-foreground">
                  {historyScope === "rexalgo"
                    ? "RexAlgo mode filters recent closes to trades placed through RexAlgo. Older trades before exact position-id attribution may be incomplete."
                    : "Recent closes from Mudrex (newest first). P&L uses exchange data when available; otherwise we estimate from prices and size (fees not included)."}
                </p>
              </div>
              <ScopePills value={historyScope} onChange={setHistoryScope} />
            </div>
            {historyQ.isPending || (historyScope === "rexalgo" && activityQ.isPending) ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading position history…</p>
            ) : historyQ.isError && !isAdmin ? (
              <p className="text-sm text-muted-foreground py-8 text-center leading-relaxed max-w-md mx-auto">
                Trade history will appear here after your account data loads. Use the dashboard{" "}
                <span className="font-medium text-foreground">Refresh</span> button to retry.
              </p>
            ) : displayedHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border/60 bg-secondary/20">
                {historyScope === "rexalgo"
                  ? "No RexAlgo closed positions matched this history window yet."
                  : "No closed positions in this history window yet."}
              </p>
            ) : (
              <div className="overflow-x-auto max-h-[min(28rem,50vh)] overflow-y-auto rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-[1] bg-secondary/95 backdrop-blur-sm">
                    <tr className="text-muted-foreground text-xs border-b border-border">
                      <th className="text-left py-3 px-3 font-medium">Pair</th>
                      <th className="text-left py-3 px-3 font-medium">Side</th>
                      <th className="text-right py-3 px-3 font-medium">Qty</th>
                      <th className="text-right py-3 px-3 font-medium">Lev.</th>
                      <th className="text-right py-3 px-3 font-medium">Entry</th>
                      <th className="text-right py-3 px-3 font-medium">Last mark</th>
                      <th className="text-right py-3 px-3 font-medium">Realized</th>
                      <th className="text-right py-3 px-3 font-medium">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedHistory.map((p) => {
                      const realized = parseFloat(p.realized_pnl ?? "0");
                      const entry = parseFloat(p.entry_price ?? "0");
                      const mark = parseFloat(p.mark_price ?? "0");
                      const absR = Math.abs(realized);
                      const pnlDecimals = absR === 0 ? 2 : absR < 0.01 ? 6 : absR < 1 ? 4 : 2;
                      return (
                        <tr
                          key={`${p.position_id}-${p.closed_at ?? p.updated_at ?? ""}`}
                          className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                        >
                          <td className="py-3 px-3 font-medium">{formatPair(p.symbol)}</td>
                          <td className="py-3 px-3">
                            <span
                              className={`text-xs font-medium px-2 py-1 rounded ${
                                p.side === "LONG"
                                  ? "bg-profit/10 text-profit"
                                  : "bg-loss/10 text-loss"
                              }`}
                            >
                              {p.side}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono">{p.quantity}</td>
                          <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                            {formatLeverageX(p.leverage)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                            ${entry.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                            ${mark.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <span
                              className={`font-mono font-medium ${
                                realized >= 0 ? "text-profit" : "text-loss"
                              }`}
                            >
                              {realized >= 0 ? "+" : ""}${realized.toFixed(pnlDecimals)}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                            {formatClosedWhen(p)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
