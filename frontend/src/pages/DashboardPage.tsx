import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import Navbar from "@/components/Navbar";
import PerformanceChart from "@/components/PerformanceChart";
import { Button } from "@/components/ui/button";
import { TrendingUp, BarChart3, Users, ArrowUpRight, ArrowDownRight, Wallet } from "lucide-react";
import {
  fetchWallet,
  fetchPositions,
  fetchPositionHistory,
  fetchSubscriptions,
  ApiError,
  type ApiPosition,
} from "@/lib/api";
import { formatPair } from "@/lib/format";
import { useRequireAuth } from "@/hooks/useAuth";

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

export default function DashboardPage() {
  useRequireAuth();
  const navigate = useNavigate();

  const walletQ = useQuery({
    queryKey: ["wallet"],
    queryFn: fetchWallet,
    retry: false,
  });
  const posQ = useQuery({
    queryKey: ["positions"],
    queryFn: fetchPositions,
    retry: false,
  });
  const subQ = useQuery({
    queryKey: ["subscriptions"],
    queryFn: fetchSubscriptions,
    retry: false,
  });
  const historyQ = useQuery({
    queryKey: ["positions", "history"],
    queryFn: fetchPositionHistory,
    retry: false,
  });

  useEffect(() => {
    const err = walletQ.error || posQ.error || subQ.error || historyQ.error;
    if (err instanceof ApiError && err.status === 401) {
      navigate("/auth", { replace: true });
    }
  }, [walletQ.error, posQ.error, subQ.error, historyQ.error, navigate]);

  const loading = walletQ.isPending || posQ.isPending || subQ.isPending;
  const spot = walletQ.data?.spot;
  const futures = walletQ.data?.futures;
  const positions = posQ.data?.positions ?? [];
  const subs = subQ.data?.subscriptions?.filter((s) => s.isActive) ?? [];

  const spotAvail = parseFloat(spot?.withdrawable ?? "0");
  const futBal = parseFloat(futures?.balance ?? "0");
  const portfolioApprox = spotAvail + futBal;
  const unrealized = positions.reduce(
    (s, p) => s + parseFloat(p.unrealized_pnl ?? "0"),
    0
  );
  const chartData = buildRealizedPnlCurve(historyQ.data?.positions ?? []);

  const statCards = [
    {
      label: "Est. portfolio",
      value: `$${portfolioApprox.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
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
            <p className="text-sm text-muted-foreground">Live balances & positions via Mudrex API</p>
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

        <div className="glass rounded-xl p-6 mb-6 animate-fade-up-delay-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
            <div>
              <span className="text-sm text-muted-foreground">Futures wallet</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-mono font-bold text-foreground">
                  ${futBal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  Spot avail: ${spotAvail.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {statCards.map((s, i) => (
            <div
              key={s.label}
              className="glass rounded-xl p-5 animate-fade-up"
              style={{ animationDelay: `${(i + 2) * 100}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <s.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-xl font-mono font-bold">
                    {loading ? "—" : s.value}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="glass rounded-xl p-6 mb-8 animate-fade-up-delay-3">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Realized P&amp;L (closed positions)
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Built from your Mudrex position history (latest page). Not a full account audit — use Mudrex
            statements for tax and reconciliation.
          </p>
          {historyQ.isPending ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Loading history from Mudrex…</p>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No closed positions with realized P&amp;L in this history window, or amounts are zero. Open
              P&amp;L is shown above.
            </p>
          ) : (
            <PerformanceChart data={chartData} valueLabel="Cumulative realized P&amp;L" />
          )}
        </div>

        <div className="glass rounded-xl p-6 animate-fade-up-delay-4">
          <h2 className="font-semibold mb-4">Open positions</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : positions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No open positions. Fund futures and trade on Mudrex, or subscribe to a strategy.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs border-b border-border">
                    <th className="text-left py-3 font-medium">Pair</th>
                    <th className="text-left py-3 font-medium">Side</th>
                    <th className="text-right py-3 font-medium">Qty</th>
                    <th className="text-right py-3 font-medium">Entry</th>
                    <th className="text-right py-3 font-medium">Mark</th>
                    <th className="text-right py-3 font-medium">P&amp;L</th>
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
                        <td className="py-3 font-medium">{formatPair(p.symbol)}</td>
                        <td className="py-3">
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
                        <td className="py-3 text-right font-mono">{p.quantity}</td>
                        <td className="py-3 text-right font-mono text-muted-foreground">
                          ${entry.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 text-right font-mono">
                          ${mark.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {pnl >= 0 ? (
                              <ArrowUpRight className="w-3.5 h-3.5 text-profit" />
                            ) : (
                              <ArrowDownRight className="w-3.5 h-3.5 text-loss" />
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
      </div>
    </div>
  );
}
