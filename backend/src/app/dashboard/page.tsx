"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MudrexFuturesBalance, MudrexWalletBalance, MudrexPosition, Subscription } from "@/types";

export default function DashboardPage() {
  const [spot, setSpot] = useState<MudrexWalletBalance | null>(null);
  const [futures, setFutures] = useState<MudrexFuturesBalance | null>(null);
  const [positions, setPositions] = useState<MudrexPosition[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [walletRes, posRes, subRes] = await Promise.all([
          fetch("/api/mudrex/wallet"),
          fetch("/api/mudrex/positions"),
          fetch("/api/subscriptions"),
        ]);

        if (walletRes.ok) {
          const data = await walletRes.json();
          setSpot(data.spot);
          setFutures(data.futures);
        }
        if (posRes.ok) {
          const data = await posRes.json();
          setPositions(data.positions || []);
        }
        if (subRes.ok) {
          const data = await subRes.json();
          setSubscriptions(data.subscriptions || []);
        }
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const totalPnl = positions.reduce(
    (sum, p) => sum + parseFloat(p.unrealized_pnl || "0"),
    0
  );

  const activeSubs = subscriptions.filter((s) => s.isActive).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="bg-card/50 border-border/50">
              <CardContent className="pt-6">
                <div className="h-4 w-20 bg-muted rounded animate-pulse mb-2" />
                <div className="h-8 w-28 bg-muted rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-2">
          <Link href="/dashboard/copy-trading/create">
            <Button variant="outline" size="sm">
              Create Strategy
            </Button>
          </Link>
          <Link href="/dashboard/copy-trading">
            <Button size="sm">Browse Strategies</Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardDescription>Spot Balance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${parseFloat(spot?.withdrawable || "0").toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Total: ${parseFloat(spot?.total || "0").toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardDescription>Futures Balance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${parseFloat(futures?.balance || "0").toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Locked: ${parseFloat(futures?.locked_amount || "0").toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardDescription>Unrealized PnL</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {positions.length} open position{positions.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardDescription>Active Subscriptions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSubs}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {subscriptions.length} total
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Open Positions Preview */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Open Positions</CardTitle>
            <CardDescription>Your active futures positions</CardDescription>
          </div>
          <Link href="/dashboard/positions">
            <Button variant="ghost" size="sm">
              View All
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No open positions. Start trading to see your positions here.
            </p>
          ) : (
            <div className="space-y-3">
              {positions.slice(0, 5).map((pos) => {
                const pnl = parseFloat(pos.unrealized_pnl || "0");
                return (
                  <div
                    key={pos.position_id}
                    className="flex items-center justify-between p-3 rounded-lg bg-background/50"
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant="outline"
                        className={
                          pos.side === "LONG"
                            ? "text-emerald-400 border-emerald-500/20"
                            : "text-red-400 border-red-500/20"
                        }
                      >
                        {pos.side}
                      </Badge>
                      <div>
                        <div className="font-medium text-sm">{pos.symbol}</div>
                        <div className="text-xs text-muted-foreground">
                          {pos.leverage}x &middot; Qty: {pos.quantity}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-sm font-medium ${
                          pnl >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Entry: ${parseFloat(pos.entry_price || "0").toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors">
          <CardHeader>
            <CardTitle className="text-lg">Copy Trading</CardTitle>
            <CardDescription>
              Follow top traders and mirror their trades with your own margin
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/copy-trading">
              <Button className="w-full">Browse Traders</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors">
          <CardHeader>
            <CardTitle className="text-lg">Algo Strategies</CardTitle>
            <CardDescription>
              Subscribe to rule-based strategies that trade systematically
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/strategies">
              <Button className="w-full">Explore Strategies</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
