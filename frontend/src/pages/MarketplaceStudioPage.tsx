import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useRequireAuth } from "@/hooks/useAuth";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import {
  fetchMarketplaceStudioStrategies,
  createMarketplaceStudioStrategy,
  setMarketplaceStrategyWebhook,
  fetchMarketplaceStrategySignals,
  patchStrategy,
  parseStrategyBacktestSpec,
  ApiError,
} from "@/lib/api";
import StrategyBacktestPanel from "@/components/StrategyBacktestPanel";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Sparkles,
  RefreshCw,
  Power,
  PowerOff,
} from "lucide-react";

function buildWebhookUrl(
  publicBase: string | null,
  path: string,
  originFallback: string
): string {
  const base = (publicBase || originFallback).replace(/\/$/, "");
  return `${base}${path}`;
}

export default function MarketplaceStudioPage() {
  const authQ = useRequireAuth();
  const queryClient = useQueryClient();
  const sessionAuthed = authQ.authed;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secretFlash, setSecretFlash] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const originFallback =
    typeof window !== "undefined" ? `${window.location.origin}` : "";

  const studioQ = useQuery({
    queryKey: ["marketplace-studio", "strategies"],
    queryFn: fetchMarketplaceStudioStrategies,
    enabled: sessionAuthed,
    ...liveDataQueryOptions,
  });

  const strategies = useMemo(
    () => studioQ.data?.strategies ?? [],
    [studioQ.data?.strategies]
  );
  const publicBase = studioQ.data?.publicBaseUrl ?? null;

  useEffect(() => {
    if (!selectedId && strategies.length > 0) {
      setSelectedId(strategies[0].id);
    }
    if (selectedId && strategies.every((s) => s.id !== selectedId)) {
      setSelectedId(strategies[0]?.id ?? null);
    }
  }, [strategies, selectedId]);

  const selected = strategies.find((s) => s.id === selectedId) ?? null;

  const signalsQ = useQuery({
    queryKey: ["marketplace-studio", "signals", selectedId],
    queryFn: () => fetchMarketplaceStrategySignals(selectedId!),
    enabled: sessionAuthed && Boolean(selectedId),
    ...liveDataQueryOptions,
  });

  const createMut = useMutation({
    mutationFn: createMarketplaceStudioStrategy,
    onSuccess: (data) => {
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["marketplace-studio", "strategies"] });
      void queryClient.invalidateQueries({ queryKey: ["strategies", "algo"] });
      setSelectedId(data.strategy.id);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Create failed");
    },
  });

  const webhookMut = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "enable" | "disable" | "rotate";
    }) => setMarketplaceStrategyWebhook(id, action),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["marketplace-studio", "strategies"] });
      if (data.secretPlain) {
        setSecretFlash(data.secretPlain);
      }
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Webhook update failed");
    },
  });

  const activeMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      patchStrategy(id, { isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["marketplace-studio", "strategies"] });
      void queryClient.invalidateQueries({ queryKey: ["strategies", "algo"] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Update failed");
    },
  });

  const specMut = useMutation({
    mutationFn: ({
      id,
      fastPeriod,
      slowPeriod,
    }: {
      id: string;
      fastPeriod: number;
      slowPeriod: number;
    }) =>
      patchStrategy(id, {
        backtestSpec: {
          engine: "sma_cross",
          params: { fastPeriod, slowPeriod },
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["marketplace-studio", "strategies"] });
      void queryClient.invalidateQueries({ queryKey: ["strategies", "algo"] });
      toast.success("Simulation settings saved");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Save failed");
    },
  });

  const webhookDisplayUrl = selected
    ? buildWebhookUrl(publicBase, selected.webhookPath, originFallback)
    : "";

  const pythonSnippet = selected
    ? `import hashlib
import hmac
import json
import time
import urllib.request

WEBHOOK_URL = "${webhookDisplayUrl}"
SECRET = "PASTE_SIGNING_SECRET_FROM_STUDIO".encode("utf-8")

body = {
    "idempotency_key": "unique-per-signal-uuid",
    "action": "open",
    "symbol": "BTCUSDT",
    "side": "LONG",
    "trigger_type": "MARKET",
}
raw = json.dumps(body, separators=(",", ":"))
t = int(time.time())
msg = f"{t}.{raw}".encode("utf-8")
sig = hmac.new(SECRET, msg, hashlib.sha256).hexdigest()

req = urllib.request.Request(
    WEBHOOK_URL,
    data=raw.encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "X-RexAlgo-Signature": f"t={t},v1={sig}",
    },
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as res:
    print(res.status, res.read().decode())`
    : "";

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Copy failed");
    }
  }

  if (!authQ.authResolved) {
    return <AuthGateSplash />;
  }
  if (!authQ.data?.user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16 max-w-5xl">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link
              to="/marketplace"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3"
            >
              <ArrowLeft className="w-4 h-4" /> Back to marketplace
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-primary" />
              Strategy studio
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Create algo listings, turn on the signed webhook, and mirror signals to subscribers on Mudrex.
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="hero">New algo strategy</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create algo strategy</DialogTitle>
              </DialogHeader>
              <AlgoCreateForm
                loading={createMut.isPending}
                onSubmit={(v) =>
                  createMut.mutate({
                    ...v,
                    backtestSpec: {
                      engine: "sma_cross",
                      params: {
                        fastPeriod: v.fastPeriod,
                        slowPeriod: v.slowPeriod,
                      },
                    },
                  })
                }
              />
            </DialogContent>
          </Dialog>
        </div>

        {secretFlash && (
          <div className="mb-6 p-4 rounded-xl border border-profit/30 bg-profit/10 text-sm">
            <p className="font-medium text-profit mb-2">Signing secret (copy now; one-time display)</p>
            <div className="flex gap-2 items-center">
              <code className="text-xs break-all flex-1 font-mono bg-background/80 p-2 rounded">
                {secretFlash}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyText(secretFlash)}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setSecretFlash(null)}>
              Dismiss
            </Button>
          </div>
        )}

        {studioQ.isLoading ? (
          <div className="flex justify-center py-24 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : strategies.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No algo strategies yet</CardTitle>
              <CardDescription>Create one to appear on the marketplace and receive webhook signals.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your algo strategies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {strategies.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                      selectedId === s.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{s.name}</span>
                      {!s.isActive && (
                        <Badge variant="secondary" className="text-xs">
                          Paused
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{s.symbol}</div>
                    <div className="text-xs mt-1">Webhook: {s.webhookEnabled ? "on" : "off"}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {selected && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>{selected.name}</CardTitle>
                    <CardDescription>{selected.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                      <div>
                        <p className="text-sm font-medium">Listing active</p>
                        <p className="text-xs text-muted-foreground">
                          When off, the strategy stays in the API but you can hide it from subscribers; webhook
                          mirroring also skips while inactive.
                        </p>
                      </div>
                      <Switch
                        checked={selected.isActive}
                        disabled={activeMut.isPending}
                        onCheckedChange={(checked) =>
                          activeMut.mutate({ id: selected.id, isActive: checked })
                        }
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={webhookMut.isPending || selected.webhookEnabled}
                        onClick={() => webhookMut.mutate({ id: selected.id, action: "enable" })}
                      >
                        <Power className="w-4 h-4 mr-1" />
                        Enable webhook
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={webhookMut.isPending || !selected.webhookEnabled}
                        onClick={() => webhookMut.mutate({ id: selected.id, action: "disable" })}
                      >
                        <PowerOff className="w-4 h-4 mr-1" />
                        Disable
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={webhookMut.isPending}
                        onClick={() => webhookMut.mutate({ id: selected.id, action: "rotate" })}
                      >
                        <RefreshCw className="w-4 h-4 mr-1" />
                        Rotate secret
                      </Button>
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">Webhook URL</Label>
                      <div className="flex gap-2 mt-1">
                        <Input readOnly value={webhookDisplayUrl} className="font-mono text-xs" />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => void copyText(webhookDisplayUrl)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Same endpoint as copy trading: <code className="text-foreground/80">/api/webhooks/copy-trading/&lt;id&gt;</code>
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <StudioBacktestSpecCard
                  strategyId={selected.id}
                  backtestSpecJson={selected.backtestSpecJson}
                  saving={specMut.isPending}
                  onSave={(fastPeriod, slowPeriod) =>
                    specMut.mutate({ id: selected.id, fastPeriod, slowPeriod })
                  }
                />

                <StrategyBacktestPanel
                  strategyId={selected.id}
                  strategyName={selected.name}
                />

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Signal format (JSON)</CardTitle>
                    <CardDescription>
                      HMAC header <code className="text-xs">X-RexAlgo-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code> over{" "}
                      <code className="text-xs">t + &quot;.&quot; + rawBody</code>.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono">
{`{
  "idempotency_key": "uuid-v4",
  "action": "open",
  "symbol": "BTCUSDT",
  "side": "LONG",
  "trigger_type": "MARKET"
}`}
                    </pre>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Python example</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono whitespace-pre-wrap">
                      {pythonSnippet}
                    </pre>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => void copyText(pythonSnippet)}
                    >
                      <Copy className="w-4 h-4 mr-1" /> Copy snippet
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent signals</CardTitle>
                    <CardDescription>Last 50 webhook deliveries.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {signalsQ.isLoading ? (
                      <p className="text-sm text-muted-foreground">Loading…</p>
                    ) : (signalsQ.data?.signals ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No signals yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                              <th className="py-2 pr-2">Time</th>
                              <th className="py-2 pr-2">Idempotency</th>
                              <th className="py-2 pr-2">Mirror OK / err</th>
                            </tr>
                          </thead>
                          <tbody>
                            {signalsQ.data!.signals.map((row) => (
                              <tr key={row.id} className="border-b border-border/50">
                                <td className="py-2 pr-2 font-mono text-xs whitespace-nowrap">
                                  {new Date(row.receivedAt).toLocaleString()}
                                </td>
                                <td className="py-2 pr-2 font-mono text-xs truncate max-w-[140px]">
                                  {row.idempotencyKey}
                                </td>
                                <td className="py-2 pr-2">
                                  <span className="text-profit">{row.mirror.ok}</span>
                                  {" / "}
                                  <span className="text-loss">{row.mirror.err}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  Futures trading is high risk. Mirroring can fail per subscriber. Not financial advice.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StudioBacktestSpecCard({
  strategyId,
  backtestSpecJson,
  saving,
  onSave,
}: {
  strategyId: string;
  backtestSpecJson: string | null | undefined;
  saving: boolean;
  onSave: (fastPeriod: number, slowPeriod: number) => void;
}) {
  const [fast, setFast] = useState("10");
  const [slow, setSlow] = useState("30");

  useEffect(() => {
    const p = parseStrategyBacktestSpec(backtestSpecJson);
    setFast(String(p?.params.fastPeriod ?? 10));
    setSlow(String(p?.params.slowPeriod ?? 30));
  }, [strategyId, backtestSpecJson]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Simulation logic (this listing)</CardTitle>
        <CardDescription>
          Shoppers run a simulation that uses these parameters together with symbol, timeframe, side, and
          stops from the listing. Webhook signals are separate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Engine: <span className="text-foreground font-medium">Moving average crossover</span> (fast vs slow
          SMA on the listing timeframe).
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="spec-fast">Fast period (bars)</Label>
            <Input
              id="spec-fast"
              type="number"
              min={2}
              className="mt-1 font-mono"
              value={fast}
              onChange={(e) => setFast(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="spec-slow">Slow period (bars)</Label>
            <Input
              id="spec-slow"
              type="number"
              min={3}
              className="mt-1 font-mono"
              value={slow}
              onChange={(e) => setSlow(e.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => {
            const fp = parseInt(fast, 10);
            const sp = parseInt(slow, 10);
            if (!Number.isInteger(fp) || !Number.isInteger(sp) || fp < 2 || sp < 2 || fp >= sp) {
              toast.error("Fast and slow must be integers ≥ 2, with fast < slow.");
              return;
            }
            onSave(fp, sp);
          }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save simulation settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AlgoCreateForm({
  onSubmit,
  loading,
}: {
  loading: boolean;
  onSubmit: (v: {
    name: string;
    description: string;
    symbol: string;
    side: "LONG" | "SHORT" | "BOTH";
    leverage: string;
    riskLevel: "low" | "medium" | "high";
    timeframe: string;
    fastPeriod: number;
    slowPeriod: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<"LONG" | "SHORT" | "BOTH">("BOTH");
  const [leverage, setLeverage] = useState("5");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">("medium");
  const [timeframe, setTimeframe] = useState("1h");
  const [fastPeriod, setFastPeriod] = useState("10");
  const [slowPeriod, setSlowPeriod] = useState("30");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !description.trim() || !symbol.trim()) return;
        const fp = parseInt(fastPeriod, 10);
        const sp = parseInt(slowPeriod, 10);
        if (!Number.isInteger(fp) || !Number.isInteger(sp) || fp < 2 || sp < 2 || fp >= sp) {
          toast.error("Fast and slow periods: integers ≥ 2, fast < slow.");
          return;
        }
        onSubmit({
          name: name.trim(),
          description: description.trim(),
          symbol: symbol.trim().toUpperCase(),
          side,
          leverage,
          riskLevel,
          timeframe,
          fastPeriod: fp,
          slowPeriod: sp,
        });
      }}
    >
      <div>
        <Label htmlFor="ms-name">Name</Label>
        <Input
          id="ms-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1"
          required
        />
      </div>
      <div>
        <Label htmlFor="ms-desc">Description</Label>
        <Textarea
          id="ms-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 min-h-[100px]"
          required
        />
      </div>
      <div>
        <Label htmlFor="ms-sym">Symbol (Mudrex)</Label>
        <Input
          id="ms-sym"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="mt-1 font-mono"
          required
        />
      </div>
      <div>
        <Label>Side</Label>
        <Select value={side} onValueChange={(v) => setSide(v as typeof side)}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BOTH">BOTH</SelectItem>
            <SelectItem value="LONG">LONG</SelectItem>
            <SelectItem value="SHORT">SHORT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="ms-lev">Leverage (for followers)</Label>
        <Input
          id="ms-lev"
          value={leverage}
          onChange={(e) => setLeverage(e.target.value)}
          className="mt-1 font-mono"
        />
      </div>
      <div>
        <Label>Risk</Label>
        <Select value={riskLevel} onValueChange={(v) => setRiskLevel(v as typeof riskLevel)}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="ms-tf">Timeframe</Label>
        <Input
          id="ms-tf"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          className="mt-1"
        />
      </div>
      <div className="rounded-lg border border-border/60 p-3 space-y-3 bg-secondary/20">
        <p className="text-xs font-medium text-foreground">Simulation logic (same as listing)</p>
        <p className="text-xs text-muted-foreground">
          Moving average crossover — used when anyone runs a simulation for this strategy.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="ms-fast" className="text-xs">
              Fast period
            </Label>
            <Input
              id="ms-fast"
              type="number"
              min={2}
              className="mt-1 font-mono text-sm"
              value={fastPeriod}
              onChange={(e) => setFastPeriod(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ms-slow" className="text-xs">
              Slow period
            </Label>
            <Input
              id="ms-slow"
              type="number"
              min={3}
              className="mt-1 font-mono text-sm"
              value={slowPeriod}
              onChange={(e) => setSlowPeriod(e.target.value)}
            />
          </div>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
      </Button>
    </form>
  );
}
