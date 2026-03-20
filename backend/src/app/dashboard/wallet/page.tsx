"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { MudrexWalletBalance, MudrexFuturesBalance } from "@/types";

export default function WalletPage() {
  const [spot, setSpot] = useState<MudrexWalletBalance | null>(null);
  const [futures, setFutures] = useState<MudrexFuturesBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDirection, setTransferDirection] = useState<"to_futures" | "to_spot">("to_futures");
  const [transferring, setTransferring] = useState(false);

  async function fetchBalances() {
    try {
      const res = await fetch("/api/mudrex/wallet");
      if (res.ok) {
        const data = await res.json();
        setSpot(data.spot);
        setFutures(data.futures);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBalances();
  }, []);

  async function handleTransfer() {
    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    setTransferring(true);
    try {
      const res = await fetch("/api/mudrex/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: transferDirection === "to_futures" ? "SPOT" : "FUTURES",
          to: transferDirection === "to_futures" ? "FUTURES" : "SPOT",
          amount: transferAmount,
        }),
      });

      if (res.ok) {
        toast.success(`Transferred $${transferAmount} successfully`);
        setTransferAmount("");
        fetchBalances();
      } else {
        const data = await res.json();
        toast.error(data.error || "Transfer failed");
      }
    } catch {
      toast.error("Transfer failed");
    } finally {
      setTransferring(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Wallet</h1>
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
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
      <h1 className="text-2xl font-bold">Wallet</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Spot Wallet</CardTitle>
            <CardDescription>Your Mudrex spot balance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-mono font-medium">
                ${parseFloat(spot?.total || "0").toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available</span>
              <span className="font-mono font-medium text-emerald-400">
                ${parseFloat(spot?.withdrawable || "0").toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invested</span>
              <span className="font-mono font-medium">
                ${parseFloat(spot?.invested || "0").toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rewards</span>
              <span className="font-mono font-medium">
                ${parseFloat(spot?.rewards || "0").toFixed(2)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Futures Wallet</CardTitle>
            <CardDescription>Your Mudrex futures balance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Balance</span>
              <span className="font-mono font-medium">
                ${parseFloat(futures?.balance || "0").toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available</span>
              <span className="font-mono font-medium text-emerald-400">
                $
                {(
                  parseFloat(futures?.balance || "0") -
                  parseFloat(futures?.locked_amount || "0")
                ).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Locked</span>
              <span className="font-mono font-medium">
                ${parseFloat(futures?.locked_amount || "0").toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Unrealized PnL</span>
              <span
                className={`font-mono font-medium ${
                  parseFloat(futures?.unrealized_pnl || "0") >= 0
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                ${parseFloat(futures?.unrealized_pnl || "0").toFixed(2)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transfer Section */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Transfer Funds</CardTitle>
          <CardDescription>Move funds between spot and futures wallets</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={transferDirection === "to_futures" ? "default" : "outline"}
              onClick={() => setTransferDirection("to_futures")}
              className="flex-1"
            >
              Spot → Futures
            </Button>
            <Button
              variant={transferDirection === "to_spot" ? "default" : "outline"}
              onClick={() => setTransferDirection("to_spot")}
              className="flex-1"
            >
              Futures → Spot
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Amount (USDT)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="0.00"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                className="bg-background/50"
                step="0.01"
                min="0"
              />
              <Button
                onClick={handleTransfer}
                disabled={transferring || !transferAmount}
              >
                {transferring ? "Transferring..." : "Transfer"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Available:{" "}
              {transferDirection === "to_futures"
                ? `$${parseFloat(spot?.withdrawable || "0").toFixed(2)} in Spot`
                : `$${(
                    parseFloat(futures?.balance || "0") -
                    parseFloat(futures?.locked_amount || "0")
                  ).toFixed(2)} in Futures`}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
