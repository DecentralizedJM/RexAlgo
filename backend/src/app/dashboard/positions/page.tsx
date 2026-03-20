"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { MudrexPosition } from "@/types";

export default function PositionsPage() {
  const [positions, setPositions] = useState<MudrexPosition[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/mudrex/positions");
      if (res.ok) {
        const data = await res.json();
        setPositions(data.positions || []);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  async function handleClose(positionId: string) {
    try {
      const res = await fetch("/api/mudrex/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", positionId }),
      });

      if (res.ok) {
        toast.success("Position closed");
        fetchPositions();
      } else {
        toast.error("Failed to close position");
      }
    } catch {
      toast.error("Failed to close position");
    }
  }

  const totalPnl = positions.reduce(
    (sum, p) => sum + parseFloat(p.unrealized_pnl || "0"),
    0
  );

  const totalMargin = positions.reduce(
    (sum, p) => sum + parseFloat(p.margin || "0"),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Positions</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your open futures positions
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchPositions}>
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Open Positions</div>
            <div className="text-2xl font-bold">{positions.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total Unrealized PnL</div>
            <div
              className={`text-2xl font-bold ${
                totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total Margin Used</div>
            <div className="text-2xl font-bold">${totalMargin.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Positions Table */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle>Open Positions</CardTitle>
          <CardDescription>
            Auto-refreshes every 10 seconds
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-12 bg-muted rounded animate-pulse"
                />
              ))}
            </div>
          ) : positions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No open positions
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Mark</TableHead>
                    <TableHead>Lev</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>SL / TP</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos) => {
                    const pnl = parseFloat(pos.unrealized_pnl || "0");
                    const slPrice =
                      typeof pos.stoploss === "object"
                        ? pos.stoploss?.price
                        : pos.stoploss_price;
                    const tpPrice =
                      typeof pos.takeprofit === "object"
                        ? pos.takeprofit?.price
                        : pos.takeprofit_price;

                    return (
                      <TableRow key={pos.position_id}>
                        <TableCell className="font-medium">
                          {pos.symbol}
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {pos.quantity}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          ${parseFloat(pos.entry_price || "0").toFixed(2)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          ${parseFloat(pos.mark_price || "0").toFixed(2)}
                        </TableCell>
                        <TableCell>{pos.leverage}x</TableCell>
                        <TableCell>
                          <span
                            className={`font-mono text-xs font-medium ${
                              pnl >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {slPrice ? `SL: $${parseFloat(slPrice).toFixed(2)}` : "—"}
                          {" / "}
                          {tpPrice ? `TP: $${parseFloat(tpPrice).toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <RiskDialog
                              positionId={pos.position_id}
                              onSuccess={fetchPositions}
                            />
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleClose(pos.position_id)}
                            >
                              Close
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RiskDialog({
  positionId,
  onSuccess,
}: {
  positionId: string;
  onSuccess: () => void;
}) {
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  async function handleSave() {
    if (!sl && !tp) {
      toast.error("Enter at least one price");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/mudrex/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_risk",
          positionId,
          stoplosPrice: sl || undefined,
          takeprofitPrice: tp || undefined,
        }),
      });

      if (res.ok) {
        toast.success("Risk levels updated");
        setOpen(false);
        onSuccess();
      } else {
        toast.error("Failed to update risk levels");
      }
    } catch {
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        SL/TP
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Stop-Loss / Take-Profit</DialogTitle>
          <DialogDescription>
            Set or update risk levels for this position
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Stop Loss Price</Label>
            <Input
              type="number"
              placeholder="e.g. 95000"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              className="bg-background/50"
            />
          </div>
          <div className="space-y-2">
            <Label>Take Profit Price</Label>
            <Input
              type="number"
              placeholder="e.g. 110000"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              className="bg-background/50"
            />
          </div>
          <Button className="w-full" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Update Risk Levels"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
