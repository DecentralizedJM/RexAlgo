import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useRequireAuth } from "@/hooks/useAuth";
import {
  fetchCopyStudioStrategies,
  createCopyStudioStrategy,
  setCopyStrategyWebhook,
  fetchCopyStrategySignals,
  ApiError,
} from "@/lib/api";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Radio,
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

export default function CopyTradingStudioPage() {
  useRequireAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secretFlash, setSecretFlash] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const originFallback =
    typeof window !== "undefined" ? `${window.location.origin}` : "";

  const studioQ = useQuery({
    queryKey: ["copy-studio", "strategies"],
    queryFn: fetchCopyStudioStrategies,
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
    queryKey: ["copy-studio", "signals", selectedId],
    queryFn: () => fetchCopyStrategySignals(selectedId!),
    enabled: Boolean(selectedId),
    ...liveDataQueryOptions,
  });

  const createMut = useMutation({
    mutationFn: createCopyStudioStrategy,
    onSuccess: (data) => {
      toast.success("Strategy created");
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["copy-studio", "strategies"] });
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
    }) => setCopyStrategyWebhook(id, action),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["copy-studio", "strategies"] });
      if (data.secretPlain) {
        setSecretFlash(data.secretPlain);
        toast.message(data.message ?? "Secret shown once — copy it now.");
      } else {
        toast.success(data.enabled ? "Webhook enabled" : "Webhook disabled");
      }
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Webhook update failed");
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

# Use the exact URL below. External bots must reach your Next API (e.g. port 3000 or ngrok).
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
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-16 max-w-5xl">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link
              to="/copy-trading"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3"
            >
              <ArrowLeft className="w-4 h-4" /> Back to copy trading
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radio className="w-7 h-7 text-primary" />
              Master studio
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Publish a copy-trading listing, enable a signed webhook, and send signals from your bot
              (Python, etc.) on your own server. Followers who subscribed in RexAlgo will mirror orders on
              their Mudrex accounts.
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="hero">New copy strategy</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create copy-trading strategy</DialogTitle>
              </DialogHeader>
              <CreateStrategyForm
                loading={createMut.isPending}
                onSubmit={(v) => createMut.mutate(v)}
              />
            </DialogContent>
          </Dialog>
        </div>

        {!publicBase && (
          <div className="mb-6 p-4 rounded-xl border border-warning/30 bg-warning/10 text-sm text-foreground">
            Set <code className="px-1 bg-background/50 rounded">PUBLIC_APP_URL</code> on the API server so
            webhook URLs show correctly (e.g. your prod domain or an ngrok URL pointing at port{" "}
            <strong>3000</strong>). Until then, URLs use this browser origin (works only if your bot can
            reach the same host).
          </div>
        )}

        {secretFlash && (
          <div className="mb-6 p-4 rounded-xl border border-profit/30 bg-profit/10 text-sm">
            <p className="font-medium text-profit mb-2">Signing secret (copy now — not shown again)</p>
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
              <CardTitle>No strategies yet</CardTitle>
              <CardDescription>Create a copy-trading strategy to get a webhook URL.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your strategies</CardTitle>
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
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{s.symbol}</div>
                    <div className="text-xs mt-1">
                      Webhook: {s.webhookEnabled ? "on" : "off"}
                    </div>
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
                        Dev tip: expose <code className="text-foreground/80">127.0.0.1:3000</code> with
                        ngrok; bots cannot call Vite on 8080 unless you proxy webhooks there too.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Signal format (JSON)</CardTitle>
                    <CardDescription>
                      Header <code className="text-xs">X-RexAlgo-Signature: t=&lt;unix&gt;,v1=&lt;hmac_hex&gt;</code>{" "}
                      where HMAC-SHA256 is over the string <code className="text-xs">t + &quot;.&quot; + rawBody</code>
                      .
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
                    <p className="text-xs text-muted-foreground mt-3">
                      Use <code>action: &quot;close&quot;</code> to close one open position matching symbol and
                      side. Follower size uses each subscriber&apos;s margin and your strategy leverage.
                    </p>
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
                    <CardDescription>Last 50 webhook deliveries for this strategy.</CardDescription>
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
                  Trading futures is high risk. Mirroring can fail for individual followers (margin, limits,
                  Mudrex errors). You are responsible for your bot and your subscribers&apos; understanding
                  of risk.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateStrategyForm({
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
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<"LONG" | "SHORT" | "BOTH">("BOTH");
  const [leverage, setLeverage] = useState("5");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">("medium");
  const [timeframe, setTimeframe] = useState("1h");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !description.trim() || !symbol.trim()) return;
        onSubmit({
          name: name.trim(),
          description: description.trim(),
          symbol: symbol.trim().toUpperCase(),
          side,
          leverage,
          riskLevel,
          timeframe,
        });
      }}
    >
      <div>
        <Label htmlFor="cs-name">Name</Label>
        <Input
          id="cs-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1"
          required
        />
      </div>
      <div>
        <Label htmlFor="cs-desc">Description</Label>
        <Textarea
          id="cs-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 min-h-[100px]"
          required
        />
      </div>
      <div>
        <Label htmlFor="cs-sym">Symbol (Mudrex)</Label>
        <Input
          id="cs-sym"
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
        <Label htmlFor="cs-lev">Leverage (for followers)</Label>
        <Input
          id="cs-lev"
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
        <Label htmlFor="cs-tf">Timeframe</Label>
        <Input
          id="cs-tf"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          className="mt-1"
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
      </Button>
    </form>
  );
}
