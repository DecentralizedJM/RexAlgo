import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import PerformanceChart from "@/components/PerformanceChart";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  History,
  LineChart,
  AlertTriangle,
} from "lucide-react";
import {
  fetchWallet,
  fetchPositions,
  fetchPositionHistory,
  fetchSubscriptions,
  ApiError,
  getApiErrorCode,
  getApiErrorHint,
  type ApiPosition,
} from "@/lib/api";
import { formatPair } from "@/lib/format";
import { useRequireAuth } from "@/hooks/useAuth";
import { futuresAvailableUsdt } from "@/lib/walletFunding";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";

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

function formatClosedWhen(p: ApiPosition): string {
  const raw = p.closed_at || p.updated_at || p.created_at;
  if (!raw) return "—";
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

export default function DashboardPage() {
  const authQ = useRequireAuth();
  const navigate = useNavigate();

  const walletQ = useQuery({
    queryKey: ["wallet", "futures"],
    queryFn: () => fetchWallet({ futuresOnly: true }),
    ...liveDataQueryOptions,
    retry: false,
  });
  const posQ = useQuery({
    queryKey: ["positions"],
    queryFn: fetchPositions,
    ...liveDataQueryOptions,
    retry: false,
  });
  const subQ = useQuery({
    queryKey: ["subscriptions"],
    queryFn: fetchSubscriptions,
    ...liveDataQueryOptions,
    retry: false,
  });
  const historyQ = useQuery({
    queryKey: ["positions", "history"],
    queryFn: fetchPositionHistory,
    ...liveDataQueryOptions,
    retry: false,
  });

  useEffect(() => {
    const err = walletQ.error || posQ.error || subQ.error || historyQ.error;
    if (!(err instanceof ApiError) || err.status !== 401) return;
    // Session missing / expired → sign in. Mudrex key invalid → stay here; banner explains reconnect.
    if (getApiErrorCode(err) === "MUDREX_API_KEY_INVALID") return;
    navigate("/auth", { replace: true });
  }, [walletQ.error, posQ.error, subQ.error, historyQ.error, navigate]);

  const mudrexKeyErr = useMemo(() => {
    for (const e of [walletQ.error, posQ.error, subQ.error, historyQ.error]) {
      if (e instanceof ApiError && getApiErrorCode(e) === "MUDREX_API_KEY_INVALID") return e;
    }
    return null;
  }, [walletQ.error, posQ.error, subQ.error, historyQ.error]);

  const loading = walletQ.isPending || posQ.isPending || subQ.isPending;
  const futures = walletQ.data?.futures;
  const positions = posQ.data?.positions ?? [];
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

  const futBal = parseFloat(futures?.balance ?? "0");
  const unrealized = positions.reduce(
    (s, p) => s + parseFloat(p.unrealized_pnl ?? "0"),
    0
  );
  const chartData = buildRealizedPnlCurve(historyQ.data?.positions ?? []);

  const statCards = [
    {
      label: "Futures wallet",
      value: `$${futBal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: Wallet,
    },
    {
      label: "Active subscriptions",
      value: subs.length.toString(),
      icon: BarChart3,
    },
    {
      label: "Open positions",
      value: positions.length.toString(),
      icon: Users,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-16">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-fade-up">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Balances and positions from Mudrex. Refreshes when you focus this tab or use Refresh in the
              header.
            </p>
            {formatSessionExpiry(authQ.data?.sessionExpiresAt) && (
              <p className="text-xs text-muted-foreground mt-1">
                Browser session until{" "}
                <span className="text-foreground font-medium">
                  {formatSessionExpiry(authQ.data?.sessionExpiresAt)}
                </span>
                . Mudrex may reject the API key sooner (~90 days)—then reconnect at Sign in.
              </p>
            )}
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link to="/marketplace">
              <Button variant="outline" size="sm">
                <BarChart3 className="w-4 h-4" /> Strategies
              </Button>
            </Link>
            <Link to="/copy-trading">
              <Button variant="outline" size="sm">
                <Users className="w-4 h-4" /> Copy trading
              </Button>
            </Link>
          </div>
        </div>

        {mudrexKeyErr && (
          <div className="rounded-xl border border-loss/40 bg-loss/10 p-4 mb-6 text-sm animate-fade-up">
            <p className="font-medium text-loss">Mudrex API key problem</p>
            <p className="text-muted-foreground mt-1">{mudrexKeyErr.message}</p>
            {getApiErrorHint(mudrexKeyErr) && (
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{getApiErrorHint(mudrexKeyErr)}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 border-loss/40"
              onClick={() => navigate("/auth", { state: { from: "/dashboard" } })}
            >
              Sign in with new Mudrex key
            </Button>
          </div>
        )}

        {underfundedSubs.length > 0 && walletQ.data && (
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

        <div className="glass rounded-xl p-6 mb-6 animate-fade-up-delay-1">
          <div>
            <span className="text-sm text-muted-foreground">Unrealized P&amp;L (open)</span>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`text-2xl font-mono font-bold ${unrealized >= 0 ? "text-profit" : "text-loss"}`}
              >
                {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {statCards.map((s, i) => {
            const card = (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <s.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-xl font-mono font-bold">
                    {loading ? "—" : s.value}
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
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <LineChart className="w-4 h-4 text-primary" />
            Realized P&amp;L (closed positions)
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            From Mudrex closed-trade history (latest page). For taxes, use Mudrex statements.
          </p>
          {historyQ.isPending ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Loading history from Mudrex…</p>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No closed P&amp;L in this window yet. Open P&amp;L is above.
            </p>
          ) : (
            <PerformanceChart data={chartData} valueLabel="Cumulative realized P&amp;L" />
          )}
        </div>

        {/* Below chart: open positions + position history */}
        <div className="glass rounded-xl p-6 animate-fade-up-delay-4 space-y-10">
          <div>
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Open positions
            </h2>
            <p className="text-xs text-muted-foreground mb-4">Open futures on your Mudrex account.</p>
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
            ) : positions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border/60 bg-secondary/20">
                No open positions. Fund futures and trade on Mudrex, or subscribe to a strategy.
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
                      <th className="text-right py-3 px-3 font-medium">Unrealized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => {
                      const pnl = parseFloat(p.unrealized_pnl ?? "0");
                      const entry = parseFloat(p.entry_price ?? "0");
                      const mark = parseFloat(p.mark_price ?? "0");
                      const pct =
                        entry > 0 && p.side === "LONG"
                          ? ((mark - entry) / entry) * 100
                          : entry > 0
                            ? ((entry - mark) / entry) * 100
                            : 0;
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
                            {p.leverage ?? "—"}×
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                            ${entry.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-3 text-right font-mono">
                            ${mark.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1 flex-wrap">
                              {pnl >= 0 ? (
                                <ArrowUpRight className="w-3.5 h-3.5 text-profit shrink-0" />
                              ) : (
                                <ArrowDownRight className="w-3.5 h-3.5 text-loss shrink-0" />
                              )}
                              <span
                                className={`font-mono font-medium ${pnl >= 0 ? "text-profit" : "text-loss"}`}
                              >
                                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                              </span>
                              <span
                                className={`text-xs ${pnl >= 0 ? "text-profit" : "text-loss"}`}
                              >
                                ({pct >= 0 ? "+" : ""}
                                {pct.toFixed(2)}%)
                              </span>
                            </div>
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
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Position history
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Recent closes from Mudrex (newest first). P&amp;L uses exchange data when available; otherwise
              we estimate from prices and size (fees not included).
            </p>
            {historyQ.isPending ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading position history…</p>
            ) : closedHistorySorted.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border/60 bg-secondary/20">
                No closed positions in this history window yet.
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
                    {closedHistorySorted.map((p) => {
                      const realized = parseFloat(p.realized_pnl ?? "0");
                      const entry = parseFloat(p.entry_price ?? "0");
                      const mark = parseFloat(p.mark_price ?? "0");
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
                            {p.leverage ?? "—"}×
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
                              {realized >= 0 ? "+" : ""}${realized.toFixed(2)}
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
      </div>
    </div>
  );
}
