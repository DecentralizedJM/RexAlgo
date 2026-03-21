import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchSubscriptions,
  fetchWallet,
  cancelSubscription,
  updateSubscriptionMargin,
  ApiError,
  type ApiSubscription,
} from "@/lib/api";
import { futuresAvailableUsdt, MIN_MARGIN_PER_TRADE_USD } from "@/lib/walletFunding";
import { formatPair } from "@/lib/format";
import { useRequireAuth } from "@/hooks/useAuth";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Wallet,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

function subscriptionNeedsFunding(sub: ApiSubscription, available: number): boolean {
  if (!sub.isActive) return false;
  const m = parseFloat(sub.marginPerTrade ?? "0");
  if (!Number.isFinite(m) || m <= 0) return false;
  return available < m;
}

export default function SubscriptionsPage() {
  useRequireAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const walletQ = useQuery({
    queryKey: ["wallet", "futures"],
    queryFn: () => fetchWallet({ futuresOnly: true }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const subsQ = useQuery({
    queryKey: ["subscriptions"],
    queryFn: fetchSubscriptions,
    retry: false,
  });

  const [cancelTarget, setCancelTarget] = useState<ApiSubscription | null>(null);
  const [editTarget, setEditTarget] = useState<ApiSubscription | null>(null);
  const [editMargin, setEditMargin] = useState([50]);

  useEffect(() => {
    const err = walletQ.error || subsQ.error;
    if (err instanceof ApiError && err.status === 401) {
      navigate("/auth", { replace: true });
    }
  }, [walletQ.error, subsQ.error, navigate]);

  const available = futuresAvailableUsdt(walletQ.data);
  const subs = subsQ.data?.subscriptions ?? [];

  const underfunded = useMemo(
    () => subs.filter((s) => subscriptionNeedsFunding(s, available)),
    [subs, available]
  );

  useEffect(() => {
    if (editTarget) {
      const m = parseFloat(editTarget.marginPerTrade);
      setEditMargin([Number.isFinite(m) ? Math.round(m) : MIN_MARGIN_PER_TRADE_USD]);
    }
  }, [editTarget]);

  async function confirmCancel() {
    if (!cancelTarget) return;
    try {
      await cancelSubscription(cancelTarget.id);
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      toast.success("Subscription cancelled. Mirroring will stop for this strategy.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel");
    } finally {
      setCancelTarget(null);
    }
  }

  async function saveMargin() {
    if (!editTarget) return;
    const v = editMargin[0];
    if (v < MIN_MARGIN_PER_TRADE_USD) {
      toast.error(`Minimum margin is $${MIN_MARGIN_PER_TRADE_USD}`);
      return;
    }
    try {
      await updateSubscriptionMargin(editTarget.id, String(v));
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      toast.success("Margin per trade updated");
      setEditTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  const loading = subsQ.isPending;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-16 max-w-4xl">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>

        <div className="mb-8 animate-fade-up">
          <h1 className="text-2xl font-bold mb-2">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            Manage algo and copy-trading subscriptions: margin per trade, cancel mirroring, and funding
            checks against your Mudrex futures wallet.
          </p>
        </div>

        {walletQ.data && (
          <div className="glass rounded-xl p-4 mb-6 flex flex-wrap items-center gap-3 text-sm">
            <Wallet className="w-4 h-4 text-primary shrink-0" />
            <span className="text-muted-foreground">Futures wallet (available):</span>
            <span className="font-mono font-semibold">${available.toFixed(2)} USDT</span>
            <span className="text-xs text-muted-foreground">
              (balance − locked margin). Add funds on Mudrex if low.
            </span>
          </div>
        )}

        {underfunded.length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 mb-6 flex gap-3 text-sm">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-warning mb-1">Add futures funds</p>
              <p className="text-muted-foreground">
                {underfunded.length} active{" "}
                {underfunded.length === 1 ? "subscription needs" : "subscriptions need"} at least the{" "}
                <strong className="text-foreground">margin per trade</strong> you set in USDT. Your
                estimated available balance is below that for:
              </p>
              <ul className="mt-2 list-disc list-inside text-foreground space-y-1">
                {underfunded.map((s) => (
                  <li key={s.id}>
                    <strong>{s.strategy.name}</strong> — needs ${parseFloat(s.marginPerTrade).toFixed(2)}{" "}
                    per signal, you have ~${available.toFixed(2)} available
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="glass rounded-xl overflow-hidden animate-fade-up-delay-1">
          {loading ? (
            <p className="p-8 text-center text-muted-foreground">Loading subscriptions…</p>
          ) : subs.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground space-y-4">
              <p>No subscriptions yet.</p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button asChild variant="outline" size="sm">
                  <Link to="/marketplace">Browse strategies</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/copy-trading">Copy trading</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-secondary/30">
                    <th className="py-3 px-4 font-medium">Strategy</th>
                    <th className="py-3 px-4 font-medium">Type</th>
                    <th className="py-3 px-4 font-medium text-right">Margin / trade</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => {
                    const low = subscriptionNeedsFunding(s, available);
                    const strategyOff = s.strategy && !s.strategy.isActive;
                    return (
                      <tr
                        key={s.id}
                        className={`border-b border-border/50 ${
                          s.isActive ? "hover:bg-secondary/20" : "opacity-60"
                        }`}
                      >
                        <td className="py-3 px-4">
                          <Link
                            to={`/strategy/${s.strategyId}`}
                            className="font-medium text-foreground hover:text-primary inline-flex items-center gap-1"
                          >
                            {s.strategy.name}
                            <ExternalLink className="w-3 h-3 opacity-50" />
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatPair(s.strategy.symbol)} · {s.strategy.creatorName}
                          </p>
                          {strategyOff && s.isActive && (
                            <p className="text-xs text-warning mt-1">Creator paused this listing</p>
                          )}
                          {low && s.isActive && (
                            <p className="text-xs text-warning mt-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              Insufficient futures balance for this margin
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-[10px]">
                            {s.strategy.type === "copy_trading" ? "Copy" : "Algo"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          ${parseFloat(s.marginPerTrade).toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          {s.isActive ? (
                            <Badge className="bg-profit/15 text-profit border-profit/20">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Cancelled</Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {s.isActive ? (
                            <div className="flex justify-end gap-2 flex-wrap">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => setEditTarget(s)}
                              >
                                <Pencil className="w-3.5 h-3.5 mr-1" />
                                Edit margin
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-loss border-loss/30 hover:bg-loss/10"
                                onClick={() => setCancelTarget(s)}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-1" />
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
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

      <AlertDialog open={Boolean(cancelTarget)} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              You will stop mirroring signals for{" "}
              <strong>{cancelTarget?.strategy.name}</strong>. You can subscribe again later from the
              strategy page if it&apos;s still listed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep subscription</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmCancel()}
            >
              Cancel subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(editTarget)} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Margin per trade</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Each mirrored <strong className="text-foreground">open</strong> signal uses this USDT margin
            with the strategy leverage ({editTarget?.strategy.leverage}x on{" "}
            {editTarget?.strategy.name}).
          </p>
          <div className="bg-secondary/50 rounded-xl p-4 mb-4">
            <div className="text-2xl font-mono font-bold text-center mb-3">${editMargin[0]}</div>
            <Slider
              value={editMargin}
              onValueChange={setEditMargin}
              min={MIN_MARGIN_PER_TRADE_USD}
              max={5000}
              step={10}
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>${MIN_MARGIN_PER_TRADE_USD}</span>
              <span>$5,000</span>
            </div>
          </div>
          {editMargin[0] > available && (
            <p className="text-xs text-warning flex items-start gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              This margin exceeds your estimated futures available (${available.toFixed(2)}). Add USDT to
              your Mudrex futures wallet or lower the amount.
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Close
            </Button>
            <Button variant="hero" onClick={() => void saveMargin()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
