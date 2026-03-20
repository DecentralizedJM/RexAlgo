"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

export function CreateStrategyForm({
  type,
  redirectPath,
}: {
  type: "copy_trading" | "algo";
  redirectPath: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    symbol: "BTCUSDT",
    side: "BOTH",
    leverage: "5",
    stoplossPct: "",
    takeprofitPct: "",
    riskLevel: "medium",
    timeframe: "1h",
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.name || !form.description || !form.symbol) {
      toast.error("Please fill in all required fields");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, type }),
      });

      if (res.ok) {
        toast.success("Strategy created successfully!");
        router.push(redirectPath);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to create strategy");
      }
    } catch {
      toast.error("Failed to create strategy");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle>Strategy Info</CardTitle>
          <CardDescription>Basic information about your strategy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Strategy Name *</Label>
            <Input
              placeholder="e.g. BTC Trend Rider"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              className="bg-background/50"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Description *</Label>
            <Textarea
              placeholder="Describe your strategy, entry/exit logic, risk management..."
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              className="bg-background/50 min-h-[100px]"
              required
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle>Trading Parameters</CardTitle>
          <CardDescription>Configure trading settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Symbol *</Label>
              <Input
                placeholder="e.g. BTCUSDT"
                value={form.symbol}
                onChange={(e) => updateField("symbol", e.target.value.toUpperCase())}
                className="bg-background/50"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={form.side} onValueChange={(v) => updateField("side", v ?? "BOTH")}>
                <SelectTrigger className="bg-background/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LONG">Long Only</SelectItem>
                  <SelectItem value="SHORT">Short Only</SelectItem>
                  <SelectItem value="BOTH">Both Directions</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Leverage</Label>
              <Input
                type="number"
                min="1"
                max="125"
                value={form.leverage}
                onChange={(e) => updateField("leverage", e.target.value)}
                className="bg-background/50"
              />
            </div>

            <div className="space-y-2">
              <Label>Stop Loss (%)</Label>
              <Input
                type="number"
                step="0.1"
                placeholder="e.g. 5"
                value={form.stoplossPct}
                onChange={(e) => updateField("stoplossPct", e.target.value)}
                className="bg-background/50"
              />
            </div>

            <div className="space-y-2">
              <Label>Take Profit (%)</Label>
              <Input
                type="number"
                step="0.1"
                placeholder="e.g. 10"
                value={form.takeprofitPct}
                onChange={(e) => updateField("takeprofitPct", e.target.value)}
                className="bg-background/50"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Risk Level</Label>
              <Select
                value={form.riskLevel}
                onValueChange={(v) => updateField("riskLevel", v ?? "medium")}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low Risk</SelectItem>
                  <SelectItem value="medium">Medium Risk</SelectItem>
                  <SelectItem value="high">High Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Timeframe</Label>
              <Select
                value={form.timeframe}
                onValueChange={(v) => updateField("timeframe", v ?? "1h")}
              >
                <SelectTrigger className="bg-background/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">1 Minute</SelectItem>
                  <SelectItem value="5m">5 Minutes</SelectItem>
                  <SelectItem value="15m">15 Minutes</SelectItem>
                  <SelectItem value="30m">30 Minutes</SelectItem>
                  <SelectItem value="1h">1 Hour</SelectItem>
                  <SelectItem value="4h">4 Hours</SelectItem>
                  <SelectItem value="1d">1 Day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating..." : "Create Strategy"}
      </Button>
    </form>
  );
}
