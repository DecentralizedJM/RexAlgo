"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { Strategy, Subscription } from "@/types";

const riskColors = {
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  high: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function StrategyDetail({ strategyId }: { strategyId: string }) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [marginPerTrade, setMarginPerTrade] = useState("50");
  const [subscribing, setSubscribing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [stratRes, subRes] = await Promise.all([
          fetch(`/api/strategies/${strategyId}`),
          fetch("/api/subscriptions"),
        ]);

        if (stratRes.ok) {
          const data = await stratRes.json();
          setStrategy(data.strategy);
        }
        if (subRes.ok) {
          const data = await subRes.json();
          setSubscriptions(data.subscriptions || []);
        }
      } catch (err) {
        console.error("Fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [strategyId]);

  const existingSub = subscriptions.find(
    (s) => s.strategyId === strategyId && s.isActive
  );

  async function handleSubscribe() {
    if (!marginPerTrade || parseFloat(marginPerTrade) <= 0) {
      toast.error("Enter a valid margin per trade");
      return;
    }

    setSubscribing(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId,
          marginPerTrade,
        }),
      });

      if (res.ok) {
        toast.success("Subscribed successfully!");
        setDialogOpen(false);
        router.refresh();
        const subRes = await fetch("/api/subscriptions");
        if (subRes.ok) {
          const data = await subRes.json();
          setSubscriptions(data.subscriptions || []);
        }
        if (strategy) {
          setStrategy({
            ...strategy,
            subscriberCount: strategy.subscriberCount + 1,
          });
        }
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to subscribe");
      }
    } catch {
      toast.error("Failed to subscribe");
    } finally {
      setSubscribing(false);
    }
  }

  async function handleUnsubscribe() {
    if (!existingSub) return;

    try {
      const res = await fetch("/api/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: existingSub.id }),
      });

      if (res.ok) {
        toast.success("Unsubscribed successfully");
        const subRes = await fetch("/api/subscriptions");
        if (subRes.ok) {
          const data = await subRes.json();
          setSubscriptions(data.subscriptions || []);
        }
        if (strategy) {
          setStrategy({
            ...strategy,
            subscriberCount: Math.max(0, strategy.subscriberCount - 1),
          });
        }
      }
    } catch {
      toast.error("Failed to unsubscribe");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-64 bg-card/50 border border-border/50 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Strategy not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Badge variant="outline" className={riskColors[strategy.riskLevel]}>
            {strategy.riskLevel} risk
          </Badge>
          <Badge variant="outline">{strategy.timeframe}</Badge>
          <Badge variant="secondary">{strategy.type === "copy_trading" ? "Copy Trading" : "Algo Strategy"}</Badge>
          {strategy.isActive ? (
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Active</Badge>
          ) : (
            <Badge variant="destructive">Inactive</Badge>
          )}
        </div>
        <h1 className="text-2xl font-bold">{strategy.name}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          by {strategy.creatorName} &middot; {strategy.symbol}
        </p>
      </div>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle>Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-background/50">
              <div
                className={`text-xl font-bold ${
                  strategy.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {strategy.totalPnl >= 0 ? "+" : ""}
                {strategy.totalPnl.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">Total PnL</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-background/50">
              <div className="text-xl font-bold">{strategy.winRate.toFixed(0)}%</div>
              <div className="text-xs text-muted-foreground mt-1">Win Rate</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-background/50">
              <div className="text-xl font-bold">{strategy.totalTrades}</div>
              <div className="text-xs text-muted-foreground mt-1">Total Trades</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-background/50">
              <div className="text-xl font-bold">{strategy.subscriberCount}</div>
              <div className="text-xs text-muted-foreground mt-1">Subscribers</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {strategy.description}
          </p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle>Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Symbol</span>
              <span className="font-medium">{strategy.symbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Direction</span>
              <span className="font-medium">{strategy.side}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Leverage</span>
              <span className="font-medium">{strategy.leverage}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Timeframe</span>
              <span className="font-medium">{strategy.timeframe}</span>
            </div>
            {strategy.stoplossPct && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stop Loss</span>
                <span className="font-medium text-red-400">{strategy.stoplossPct}%</span>
              </div>
            )}
            {strategy.takeprofitPct && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Take Profit</span>
                <span className="font-medium text-emerald-400">{strategy.takeprofitPct}%</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Subscribe/Unsubscribe */}
      {existingSub ? (
        <Card className="bg-card/50 border-primary/30">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">You are subscribed</p>
                <p className="text-sm text-muted-foreground">
                  Margin per trade: ${existingSub.marginPerTrade}
                </p>
              </div>
              <Button variant="destructive" onClick={handleUnsubscribe}>
                Unsubscribe
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button size="lg" className="w-full" onClick={() => setDialogOpen(true)}>
            {strategy.type === "copy_trading" ? "Copy This Strategy" : "Subscribe to Strategy"}
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {strategy.type === "copy_trading" ? "Copy" : "Subscribe to"} {strategy.name}
              </DialogTitle>
              <DialogDescription>
                Set your margin per trade. This is the amount in USDT allocated to each trade
                executed by this strategy.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Margin per Trade (USDT) *</Label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  placeholder="e.g. 50"
                  value={marginPerTrade}
                  onChange={(e) => setMarginPerTrade(e.target.value)}
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">
                  Each trade from this strategy will use ${marginPerTrade || "0"} of your futures balance.
                  Leverage: {strategy.leverage}x &middot; Effective exposure: $
                  {(parseFloat(marginPerTrade || "0") * parseFloat(strategy.leverage)).toFixed(2)}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
                Crypto trading involves significant risk. Only subscribe with capital you can afford to lose.
              </div>

              <Button
                className="w-full"
                onClick={handleSubscribe}
                disabled={subscribing}
              >
                {subscribing ? "Subscribing..." : `Confirm — $${marginPerTrade}/trade`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
