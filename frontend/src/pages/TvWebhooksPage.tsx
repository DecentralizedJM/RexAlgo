/**
 * TradingView webhooks (Phase 5).
 *
 * Signed-in users create signed webhook URLs, choose `manual_trade` (one Mudrex
 * order per alert) or `route_to_strategy` (copy-signal into a strategy they own),
 * and review the delivery log. Secrets are shown once per create/rotate.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
  Check,
  X,
  Pencil,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import { useRequireAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { TradingViewMark } from "@/components/TradingViewMark";
import { WebhooksMark } from "@/components/WebhooksMark";
import {
  ApiError,
  createTvWebhook,
  deleteTvWebhook,
  fetchCopyStudioStrategies,
  fetchMarketplaceStudioStrategies,
  fetchTvWebhookEvents,
  fetchTvWebhooks,
  patchTvWebhook,
  rotateTvWebhookSecret,
  type TvWebhookMode,
  type TvWebhookRow,
} from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { toast } from "sonner";

export default function TvWebhooksPage() {
  const authQ = useRequireAuth();
  const queryClient = useQueryClient();
  const user = authQ.data?.user;
  const masterApproved = user?.masterAccess === "approved" || user?.isAdmin === true;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secretFlash, setSecretFlash] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** Bumps when the create dialog opens so the form remounts with fresh defaults. */
  const [createFormNonce, setCreateFormNonce] = useState(0);
  const defaultNewWebhookName = useMemo(
    () =>
      `Webhook · ${new Date().toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}`,
    [createFormNonce]
  );
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);


  const listQ = useQuery({
    queryKey: ["tv-webhooks"],
    queryFn: fetchTvWebhooks,
    enabled: Boolean(user),
    ...liveDataQueryOptions,
  });

  const webhooks = useMemo(
    () => listQ.data?.webhooks ?? [],
    [listQ.data?.webhooks]
  );

  useEffect(() => {
    if (!selectedId && webhooks.length > 0) {
      setSelectedId(webhooks[0].id);
    }
    if (selectedId && webhooks.every((w) => w.id !== selectedId)) {
      setSelectedId(webhooks[0]?.id ?? null);
    }
  }, [webhooks, selectedId]);

  const selected = webhooks.find((w) => w.id === selectedId) ?? null;

  const eventsQ = useQuery({
    queryKey: ["tv-webhooks", selectedId, "events"],
    queryFn: () => fetchTvWebhookEvents(selectedId!),
    enabled: Boolean(selectedId),
    ...liveDataQueryOptions,
  });

  const strategiesQ = useQuery({
    queryKey: ["tv-webhooks", "owned-strategies"],
    queryFn: async () => {
      // Pull both algo + copy strategies the user created; union client-side.
      const [marketplace, copy] = await Promise.all([
        fetchMarketplaceStudioStrategies().catch(() => ({ strategies: [] })),
        fetchCopyStudioStrategies().catch(() => ({ strategies: [] })),
      ]);
      return [
        ...marketplace.strategies.map((s) => ({
          id: s.id,
          name: s.name,
          type: "algo" as const,
        })),
        ...copy.strategies.map((s) => ({
          id: s.id,
          name: s.name,
          type: "copy_trading" as const,
        })),
      ];
    },
    enabled: Boolean(user) && masterApproved,
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: createTvWebhook,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["tv-webhooks"] });
      setSecretFlash(data.secretPlain);
      setSelectedId(data.webhook.id);
      setCreateOpen(false);
      toast.success("Webhook created");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Create failed");
    },
  });

  const rotateMut = useMutation({
    mutationFn: (id: string) => rotateTvWebhookSecret(id),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["tv-webhooks"] });
      setSecretFlash(data.secretPlain);
      toast.success("Secret rotated");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Rotate failed");
    },
  });

  const patchMut = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<{
        name: string;
        enabled: boolean;
        mode: TvWebhookMode;
        strategyId: string | null;
        maxMarginUsdt: number;
        defaultLeverage: number;
        defaultRiskPct: number;
      }>;
    }) => patchTvWebhook(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tv-webhooks"] });
      setRenameDraft(null);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Update failed");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTvWebhook(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tv-webhooks"] });
      setDeleteConfirmId(null);
      toast.success("Webhook deleted");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Delete failed");
    },
  });

  if (!authQ.authResolved) {
    return <AuthGateSplash />;
  }
  if (!user) {
    return null;
  }

  const ownedStrategies = strategiesQ.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16 max-w-5xl">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3"
            >
              <ArrowLeft className="w-4 h-4" /> Back to dashboard
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TradingViewMark height={28} />
              Webhooks
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Connect TradingView alerts to auto-execute trades on Mudrex. Paste
              the JSON message format from the guide into your alert after your relay
              is signing requests (see below).
            </p>
          </div>
          {!listQ.isLoading && (
            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (open) setCreateFormNonce((n) => n + 1);
              }}
            >
              <DialogTrigger asChild>
                <Button variant="hero" className="gap-1.5 shrink-0">
                  <Plus className="w-4 h-4 shrink-0" />
                  New webhook
                  <WebhooksMark
                    height={18}
                    className="text-primary-foreground opacity-90"
                  />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create webhook</DialogTitle>
                </DialogHeader>
                <CreateTvWebhookForm
                  key={createFormNonce}
                  initialName={defaultNewWebhookName}
                  loading={createMut.isPending}
                  ownedStrategies={ownedStrategies}
                  masterApproved={masterApproved}
                  onSubmit={(v) => createMut.mutate(v)}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>

        {secretFlash && (
          <div className="mb-6 p-4 rounded-xl border border-profit/30 bg-profit/10 text-sm">
            <p className="font-medium text-profit mb-2">
              Signing secret (copy now — shown once)
            </p>
            <p className="text-xs text-foreground/90 mb-2 leading-relaxed">
              <span className="font-medium text-foreground">Why?</span> A private URL
              only hides your endpoint. RexAlgo still requires a cryptographic
              signature on every request so a leaked URL cannot place trades by
              itself. Your small relay uses this secret to build{" "}
              <code className="text-[11px]">X-RexAlgo-Signature</code>; TradingView
              cannot set that header directly. Keep the URL and this secret
              confidential.
            </p>
            <div className="flex gap-2 items-center">
              <code className="text-xs break-all flex-1 font-mono bg-background/80 p-2 rounded">
                {secretFlash}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copyText(secretFlash, "Signing secret copied")}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setSecretFlash(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {listQ.isLoading ? (
          <div className="flex justify-center py-24 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Get started</CardTitle>
                <CardDescription>
                  Use <strong>New webhook</strong> above to choose a name, manual vs
                  route-to-strategy mode, and safety caps. Defaults are filled in—you
                  can edit everything before you create. Afterward, copy the URL and
                  signing secret into your relay and TradingView alert (guide below).
                </CardDescription>
              </CardHeader>
            </Card>
            <TradingViewSetupDocs />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your webhooks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {webhooks.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setSelectedId(w.id)}
                    className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                      selectedId === w.id
                        ? "border-primary/40 bg-secondary ring-1 ring-primary/15"
                        : "border-border hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{w.name}</span>
                      {!w.enabled && (
                        <Badge variant="secondary" className="text-xs">
                          disabled
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {w.mode === "manual_trade"
                        ? "Manual trade"
                        : "Routes to strategy"}
                    </div>
                    {w.lastDeliveryAt && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        last delivery {formatRelative(w.lastDeliveryAt)}
                      </div>
                    )}
                  </button>
                ))}
              </CardContent>
            </Card>

            {selected && (
              <TvWebhookDetail
                key={selected.id}
                webhook={selected}
                ownedStrategies={ownedStrategies}
                renameDraft={renameDraft}
                setRenameDraft={setRenameDraft}
                onRotate={() => rotateMut.mutate(selected.id)}
                onToggle={(enabled) =>
                  patchMut.mutate({ id: selected.id, body: { enabled } })
                }
                onRename={(name) =>
                  patchMut.mutate({ id: selected.id, body: { name } })
                }
                onChangeStrategy={(strategyId) =>
                  patchMut.mutate({ id: selected.id, body: { strategyId } })
                }
                onChangeMargin={(maxMarginUsdt) =>
                  patchMut.mutate({ id: selected.id, body: { maxMarginUsdt } })
                }
                onSaveTradeDefaults={(defaultLeverage, defaultRiskPct) =>
                  patchMut.mutate(
                    {
                      id: selected.id,
                      body: { defaultLeverage, defaultRiskPct },
                    },
                    {
                      onSuccess: () => toast.success("Settings saved"),
                    }
                  )
                }
                onDelete={() => setDeleteConfirmId(selected.id)}
                rotating={rotateMut.isPending}
                patching={patchMut.isPending}
                eventsQ={eventsQ}
              />
            )}
          </div>
        )}

        <AlertDialog
          open={deleteConfirmId !== null}
          onOpenChange={(open) => !open && setDeleteConfirmId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete webhook?</AlertDialogTitle>
              <AlertDialogDescription>
                This webhook URL and its signing secret stop working immediately.
                Any alert or relay still using them will get errors. Delivery history
                is removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (deleteConfirmId) deleteMut.mutate(deleteConfirmId);
                }}
                className="bg-loss hover:bg-loss/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

type EventsQueryResult = ReturnType<
  typeof useQuery<Awaited<ReturnType<typeof fetchTvWebhookEvents>>, Error>
>;

const TRADINGVIEW_ALERT_BUY =
  "{\n" +
  '  "action": "buy",\n' +
  '  "symbol": "BTCUSDT",\n' +
  '  "leverage": 5,\n' +
  '  "sl": {{close}} * 0.97,\n' +
  '  "tp": {{close}} * 1.06\n' +
  "}";

const TRADINGVIEW_ALERT_SELL =
  "{\n" +
  '  "action": "sell",\n' +
  '  "symbol": "BTCUSDT",\n' +
  '  "leverage": 5,\n' +
  '  "sl": {{close}} * 1.03,\n' +
  '  "tp": {{close}} * 0.94\n' +
  "}";

const TRADINGVIEW_ALERT_CLOSE =
  "{\n" + '  "action": "close",\n' + '  "symbol": "BTCUSDT"\n' + "}";

function TradingViewSetupDocs() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to set up</CardTitle>
          <CardDescription asChild>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li>Open TradingView → go to your chart with the strategy or indicator.</li>
              <li>Create an alert → set the condition to your strategy.</li>
              <li>
                Enable <strong>Webhook URL</strong> and paste your RexAlgo webhook URL.
              </li>
              <li>Set the alert message to the JSON format in the next section.</li>
            </ol>
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert message format</CardTitle>
          <CardDescription>
            Optional fields: <code className="text-xs">qty</code> (fixed size),{" "}
            <code className="text-xs">risk_pct</code> (% of futures wallet, capped by
            your max margin), <code className="text-xs">leverage</code>,{" "}
            <code className="text-xs">sl</code>, <code className="text-xs">tp</code>.
            Omit <code className="text-xs">id</code> — TradingView retries are deduped
            automatically from the message body.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Buy / Long</p>
            <div className="flex justify-end mb-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void copyText(TRADINGVIEW_ALERT_BUY, "Copied")}
              >
                <Copy className="w-3 h-3 mr-1" /> Copy
              </Button>
            </div>
            <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono whitespace-pre">
              {TRADINGVIEW_ALERT_BUY}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Sell / Short</p>
            <div className="flex justify-end mb-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void copyText(TRADINGVIEW_ALERT_SELL, "Copied")}
              >
                <Copy className="w-3 h-3 mr-1" /> Copy
              </Button>
            </div>
            <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono whitespace-pre">
              {TRADINGVIEW_ALERT_SELL}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Close position</p>
            <div className="flex justify-end mb-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void copyText(TRADINGVIEW_ALERT_CLOSE, "Copied")}
              >
                <Copy className="w-3 h-3 mr-1" /> Copy
              </Button>
            </div>
            <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono whitespace-pre">
              {TRADINGVIEW_ALERT_CLOSE}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">
            RexAlgo verifies <code className="text-xs">X-RexAlgo-Signature</code> on each
            request. TradingView cannot set custom headers, so use a tiny Cloudflare
            Worker (or similar) that receives the alert, signs the raw body with your
            signing secret, and forwards it to your RexAlgo webhook URL unchanged.
            Keep both the URL and the secret private.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function TvWebhookDetail({
  webhook,
  ownedStrategies,
  renameDraft,
  setRenameDraft,
  onRotate,
  onToggle,
  onRename,
  onChangeStrategy,
  onChangeMargin,
  onSaveTradeDefaults,
  onDelete,
  rotating,
  patching,
  eventsQ,
}: {
  webhook: TvWebhookRow;
  ownedStrategies: Array<{ id: string; name: string; type: "algo" | "copy_trading" }>;
  renameDraft: string | null;
  setRenameDraft: (v: string | null) => void;
  onRotate: () => void;
  onToggle: (enabled: boolean) => void;
  onRename: (name: string) => void;
  onChangeStrategy: (strategyId: string | null) => void;
  onChangeMargin: (maxMargin: number) => void;
  onSaveTradeDefaults: (defaultLeverage: number, defaultRiskPct: number) => void;
  onDelete: () => void;
  rotating: boolean;
  patching: boolean;
  eventsQ: EventsQueryResult;
}) {
  const [marginDraft, setMarginDraft] = useState(String(webhook.maxMarginUsdt));
  const [defLevDraft, setDefLevDraft] = useState(String(webhook.defaultLeverage ?? 5));
  const [defRiskDraft, setDefRiskDraft] = useState(String(webhook.defaultRiskPct ?? 2));
  useEffect(() => {
    setMarginDraft(String(webhook.maxMarginUsdt));
  }, [webhook.id, webhook.maxMarginUsdt]);
  useEffect(() => {
    setDefLevDraft(String(webhook.defaultLeverage ?? 5));
    setDefRiskDraft(String(webhook.defaultRiskPct ?? 2));
  }, [webhook.id, webhook.defaultLeverage, webhook.defaultRiskPct]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="truncate">{webhook.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-loss hover:text-loss"
              onClick={onDelete}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Delete
            </Button>
          </CardTitle>
          <CardDescription>
            {webhook.mode === "manual_trade"
              ? "Alerts place a single Mudrex order on your account."
              : "Alerts feed into the selected copy-trading strategy."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {webhook.enabled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-profit/15 text-profit px-2 py-0.5 font-medium">
                <Check className="w-3 h-3" /> enabled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground px-2 py-0.5 font-medium">
                disabled
              </span>
            )}
            <span>
              Last delivery:{" "}
              {webhook.lastDeliveryAt
                ? new Date(webhook.lastDeliveryAt).toLocaleString()
                : "—"}
            </span>
            {webhook.rotatedAt && (
              <span>
                Rotated: {new Date(webhook.rotatedAt).toLocaleString()}
              </span>
            )}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Webhook name</Label>
            {renameDraft !== null ? (
              <div className="flex gap-2 mt-1">
                <Input
                  autoFocus
                  value={renameDraft}
                  maxLength={120}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = renameDraft.trim();
                      if (v) onRename(v);
                    } else if (e.key === "Escape") {
                      setRenameDraft(null);
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  disabled={patching || !renameDraft.trim()}
                  onClick={() => {
                    const v = renameDraft.trim();
                    if (v) onRename(v);
                  }}
                >
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setRenameDraft(null)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm font-medium">{webhook.name}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setRenameDraft(webhook.name)}
                  aria-label="Rename webhook"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {webhook.enabled ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={patching}
                onClick={() => onToggle(false)}
              >
                <PowerOff className="w-4 h-4 mr-1" />
                Disable
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={patching}
                onClick={() => onToggle(true)}
              >
                <Power className="w-4 h-4 mr-1" />
                Enable
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rotating}
              onClick={onRotate}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${rotating ? "animate-spin" : ""}`} />
              Rotate signing secret
            </Button>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Rotating issues a new secret (shown once). Update your relay; the old
            secret stops working immediately.
          </p>

          <div>
            <Label className="text-xs text-muted-foreground">Webhook URL</Label>
            <div className="flex gap-2 mt-1">
              <Input
                readOnly
                value={webhook.webhookUrl ?? ""}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={!webhook.webhookUrl}
                onClick={() =>
                  void copyText(webhook.webhookUrl ?? "", "Webhook URL copied")
                }
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            {!webhook.webhookUrl && (
              <p className="text-xs text-warning mt-1">
                <code>PUBLIC_API_URL</code> is not configured. Paste this URL
                manually using your API host.
              </p>
            )}
          </div>

          {webhook.mode === "route_to_strategy" && (
            <div>
              <Label className="text-xs text-muted-foreground">
                Routes to strategy
              </Label>
              <Select
                value={webhook.strategyId ?? ""}
                onValueChange={(v) => onChangeStrategy(v || null)}
                disabled={patching}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pick a strategy" />
                </SelectTrigger>
                <SelectContent>
                  {ownedStrategies.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No strategies yet — create one in the studio
                    </SelectItem>
                  ) : (
                    ownedStrategies.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} · {s.type === "algo" ? "Algo" : "Copy"}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {webhook.mode === "manual_trade" && (
            <div>
              <Label
                htmlFor="tradingview-margin-cap"
                className="text-xs text-muted-foreground"
              >
                Max margin per alert (USDT)
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="tradingview-margin-cap"
                  type="number"
                  min={1}
                  step={1}
                  value={marginDraft}
                  onChange={(e) => setMarginDraft(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={patching}
                  onClick={() => {
                    const n = parseFloat(marginDraft);
                    if (!Number.isFinite(n) || n <= 0) {
                      toast.error("Enter a positive USDT amount");
                      return;
                    }
                    onChangeMargin(n);
                  }}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Hard safety cap on margin per alert. Fixed <code>qty</code>,{" "}
                <code>risk_pct</code>, and <code>qty: &quot;25 USDT&quot;</code> hints
                are clamped to this value.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {webhook.mode === "manual_trade" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default settings</CardTitle>
            <CardDescription>
              Used when your TradingView alert omits <code className="text-xs">leverage</code>{" "}
              or <code className="text-xs">risk_pct</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="tradingview-def-lev" className="text-xs text-muted-foreground">
                  Default leverage (1–100)
                </Label>
                <Input
                  id="tradingview-def-lev"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={defLevDraft}
                  onChange={(e) => setDefLevDraft(e.target.value)}
                  className="mt-1 font-mono text-sm"
                />
              </div>
              <div>
                <Label htmlFor="tradingview-def-risk" className="text-xs text-muted-foreground">
                  Risk per trade (% of futures wallet)
                </Label>
                <Input
                  id="tradingview-def-risk"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={defRiskDraft}
                  onChange={(e) => setDefRiskDraft(e.target.value)}
                  className="mt-1 font-mono text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Set risk to <code className="text-xs">0</code> to always use the max margin
              cap above (no wallet-percent sizing).
            </p>
            <Button
              type="button"
              size="sm"
              variant="hero"
              disabled={patching}
              onClick={() => {
                const lev = parseFloat(defLevDraft);
                const risk = parseFloat(defRiskDraft);
                if (!Number.isFinite(lev) || lev < 1 || lev > 100) {
                  toast.error("Leverage must be between 1 and 100");
                  return;
                }
                if (!Number.isFinite(risk) || risk < 0 || risk > 100) {
                  toast.error("Risk % must be between 0 and 100");
                  return;
                }
                onSaveTradeDefaults(Math.round(lev), risk);
              }}
            >
              Save settings
            </Button>
          </CardContent>
        </Card>
      )}

      {webhook.mode === "manual_trade" ? (
        <TradingViewSetupDocs />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Route-to-strategy message format</CardTitle>
            <CardDescription>
              This mode expects the signed RexAlgo copy-signal JSON (not the simple
              buy/sell template). Include a unique{" "}
              <code className="text-xs">idempotency_key</code> per intent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono whitespace-pre">
              {`{
  "idempotency_key": "{{strategy.order.id}}-{{timenow}}",
  "action": "open",
  "symbol": "BTCUSDT",
  "side": "LONG",
  "trigger_type": "MARKET"
}`}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent deliveries</CardTitle>
          <CardDescription>Last 50 alerts received on this webhook.</CardDescription>
        </CardHeader>
        <CardContent>
          {eventsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (eventsQ.data?.events ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No deliveries yet. Fire a test alert from TradingView to verify
              signing and execution.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-2">Time</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Detail</th>
                    <th className="py-2 pr-2">Dedupe key</th>
                  </tr>
                </thead>
                <tbody>
                  {eventsQ.data!.events.map((ev) => (
                    <tr key={ev.id} className="border-b border-border/50 align-top">
                      <td className="py-2 pr-2 font-mono text-xs whitespace-nowrap">
                        {new Date(ev.receivedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-2">
                        <EventStatus status={ev.status} />
                      </td>
                      <td className="py-2 pr-2 text-xs text-muted-foreground">
                        {ev.detail ?? "—"}
                      </td>
                      <td className="py-2 pr-2 font-mono text-xs truncate max-w-[160px]">
                        {ev.idempotencyKey}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EventStatus({ status }: { status: "accepted" | "rejected" | "error" }) {
  const cls =
    status === "accepted"
      ? "bg-profit/15 text-profit"
      : status === "rejected"
        ? "bg-warning/15 text-warning"
        : "bg-loss/15 text-loss";
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function CreateTvWebhookForm({
  initialName = "",
  onSubmit,
  loading,
  ownedStrategies,
  masterApproved,
}: {
  /** Prefilled when the dialog opens (parent remounts with `key` for a fresh value). */
  initialName?: string;
  loading: boolean;
  ownedStrategies: Array<{ id: string; name: string; type: "algo" | "copy_trading" }>;
  masterApproved: boolean;
  onSubmit: (v: {
    name: string;
    mode: TvWebhookMode;
    strategyId?: string | null;
    maxMarginUsdt?: number;
    defaultLeverage?: number;
    defaultRiskPct?: number;
  }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [mode, setMode] = useState<TvWebhookMode>("manual_trade");
  const [strategyId, setStrategyId] = useState<string>("");
  const [maxMargin, setMaxMargin] = useState("50");
  const [defLev, setDefLev] = useState("5");
  const [defRisk, setDefRisk] = useState("2");

  const canPickStrategy = masterApproved && ownedStrategies.length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const nm = name.trim();
        if (!nm) return;
        if (mode === "route_to_strategy" && !strategyId) {
          toast.error("Pick a strategy to route to");
          return;
        }
        const marginNum = parseFloat(maxMargin);
        const lev = parseFloat(defLev);
        const risk = parseFloat(defRisk);
        onSubmit({
          name: nm,
          mode,
          strategyId: mode === "route_to_strategy" ? strategyId : null,
          maxMarginUsdt:
            mode === "manual_trade" && Number.isFinite(marginNum) && marginNum > 0
              ? marginNum
              : undefined,
          defaultLeverage:
            mode === "manual_trade" && Number.isFinite(lev) && lev >= 1 && lev <= 100
              ? Math.round(lev)
              : undefined,
          defaultRiskPct:
            mode === "manual_trade" && Number.isFinite(risk) && risk >= 0 && risk <= 100
              ? risk
              : undefined,
        });
      }}
    >
      <div>
        <Label htmlFor="tradingview-wh-name">Name</Label>
        <Input
          id="tradingview-wh-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ETH 4h breakout"
          required
          className="mt-1"
        />
      </div>

      <div>
        <Label>Mode</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as TvWebhookMode)}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual_trade">
              Manual trade (one Mudrex order on my account)
            </SelectItem>
            <SelectItem value="route_to_strategy" disabled={!canPickStrategy}>
              Route to strategy {canPickStrategy ? "" : "(needs master studio)"}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "route_to_strategy" && (
        <div>
          <Label>Strategy</Label>
          <Select value={strategyId} onValueChange={setStrategyId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Pick a strategy" />
            </SelectTrigger>
            <SelectContent>
              {ownedStrategies.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {s.type === "algo" ? "Algo" : "Copy"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === "manual_trade" && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="tradingview-wh-margin">Max margin per alert (USDT)</Label>
            <Input
              id="tradingview-wh-margin"
              type="number"
              min={1}
              step={1}
              value={maxMargin}
              onChange={(e) => setMaxMargin(e.target.value)}
              className="mt-1 font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Hard safety cap on margin per alert.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tradingview-wh-lev">Default leverage</Label>
              <Input
                id="tradingview-wh-lev"
                type="number"
                min={1}
                max={100}
                step={1}
                value={defLev}
                onChange={(e) => setDefLev(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="tradingview-wh-risk">Default risk %</Label>
              <Input
                id="tradingview-wh-risk"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={defRisk}
                onChange={(e) => setDefRisk(e.target.value)}
                className="mt-1 font-mono"
              />
            </div>
          </div>
        </div>
      )}

      <Button
        type="submit"
        variant="hero"
        className="w-full gap-2"
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <WebhooksMark
              height={18}
              className="text-primary-foreground opacity-90"
            />
            Create webhook
          </>
        )}
      </Button>
    </form>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
