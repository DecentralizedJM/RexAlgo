import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import PerformanceChart from "@/components/PerformanceChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  Unplug,
} from "lucide-react";
import {
  fetchWallet,
  fetchPositions,
  fetchPositionHistory,
  fetchSubscriptions,
  linkMudrexKey,
  unlinkMudrexKey,
  ApiError,
  isMudrexCredentialError,
  type ApiPosition,
} from "@/lib/api";
import { formatPair } from "@/lib/format";
import { useRequireAuth } from "@/hooks/useAuth";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import { futuresAvailableUsdt } from "@/lib/walletFunding";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { MUDREX_PRO_TRADING_URL } from "@/lib/externalLinks";
import { MUDREX_KEY_PROBE_QUERY_KEY } from "@/lib/queryKeys";
import { toast } from "sonner";

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
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
      void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      void queryClient.invalidateQueries({ queryKey: MUDREX_KEY_PROBE_QUERY_KEY });
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

function DisconnectMudrexControl() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const onConfirm = async () => {
    setBusy(true);
    try {
      const result = await unlinkMudrexKey();
      queryClient.setQueryData(["session", "me"], {
        user: result.user,
        sessionExpiresAt: null,
      });
      await queryClient.refetchQueries({ queryKey: ["session", "me"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
      void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      void queryClient.invalidateQueries({ queryKey: MUDREX_KEY_PROBE_QUERY_KEY });
      setOpen(false);
      toast.success("Mudrex disconnected from RexAlgo");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not disconnect. Try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5 border-loss/35 text-loss hover:bg-loss/10 hover:text-loss">
          <Unplug className="h-4 w-4" />
          Disconnect Mudrex
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect Mudrex?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <span className="block">
              RexAlgo will remove your stored API secret. Balances, positions, and subscriptions will disappear
              here until you connect again.
            </span>
            <span className="block text-foreground/90">
              To rotate or revoke the key on Mudrex&apos;s side, use their API keys page, then connect a new
              secret here if you need to.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-2">
          <Button variant="hero" className="w-full sm:w-auto" asChild>
            <a href={MUDREX_PRO_TRADING_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Visit Mudrex
            </a>
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
          </Button>
          <AlertDialogCancel className="mt-0 w-full sm:w-auto" disabled={busy}>
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function DashboardPage() {
  const authQ = useRequireAuth();
  const navigate = useNavigate();
  const sessionAuthed = authQ.authed;
  const hasMudrexKey = authQ.data?.user?.hasMudrexKey ?? false;

  const walletQ = useQuery({
    queryKey: ["wallet", "futures"],
    queryFn: () => fetchWallet({ futuresOnly: true }),
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: false,
  });
  const posQ = useQuery({
    queryKey: ["positions"],
    queryFn: fetchPositions,
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: false,
  });
  const subQ = useQuery({
    queryKey: ["subscriptions"],
    queryFn: fetchSubscriptions,
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: false,
  });
  const historyQ = useQuery({
    queryKey: ["positions", "history"],
    queryFn: fetchPositionHistory,
    enabled: sessionAuthed && hasMudrexKey,
    ...liveDataQueryOptions,
    retry: false,
  });

  useEffect(() => {
    const err = walletQ.error || posQ.error || subQ.error || historyQ.error;
    if (!(err instanceof ApiError) || err.status !== 401) return;
    // Session missing / expired → sign in. Mudrex key invalid → stay here; banner explains reconnect.
    if (isMudrexCredentialError(err)) return;
    navigate("/auth", { replace: true });
  }, [walletQ.error, posQ.error, subQ.error, historyQ.error, navigate]);

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
  const chartData = buildRealizedPnlCurve(historyQ.data?.positions ?? []);

  if (!authQ.authResolved) {
    return <AuthGateSplash />;
  }
  if (!authQ.data?.user) {
    return null;
  }

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
      <div className="container mx-auto px-4 main-nav-pad pb-16">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-fade-up">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {hasMudrexKey ? (
                <>
                  Balances and positions from Mudrex. Refreshes when you focus this tab or use Refresh in the
                  header.
                </>
              ) : (
                <>Connect your Mudrex API key below to load balances, positions, and trading data.</>
              )}
            </p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/30 px-3 py-1 text-xs text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${hasMudrexKey ? "bg-profit" : "bg-warning"}`}
                aria-hidden
              />
              {hasMudrexKey ? "API connected" : "API not connected"}
            </div>
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
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {hasMudrexKey && <DisconnectMudrexControl />}
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

        {!hasMudrexKey && <ConnectMudrexCard />}

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
                    {loading ? "N/A" : s.value}
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
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => {
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
                            {p.leverage ?? "N/A"}×
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
                            {p.leverage ?? "N/A"}×
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
