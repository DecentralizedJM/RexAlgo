/**
 * TV Webhooks (Phase 5).
 *
 * A user-owned page where any signed-in user can spin up one or more
 * signed TradingView webhook URLs, pick between `manual_trade` (a single Mudrex
 * order on their account) and `route_to_strategy` (feeds an existing
 * copy-trade strategy they own), and review the delivery log.
 *
 * Secrets are shown exactly once per create/rotate and cleared on dismiss — the
 * page intentionally does not keep them in persistent state.
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
              Turn TradingView alerts into trades. Each webhook is signed with its
              own secret and can either execute a single order on your Mudrex
              account or route signals into one of your copy-trading strategies.
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button variant="hero">
                <Plus className="w-4 h-4 mr-1" /> New webhook
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create TV webhook</DialogTitle>
              </DialogHeader>
              <CreateTvWebhookForm
                loading={createMut.isPending}
                ownedStrategies={ownedStrategies}
                masterApproved={masterApproved}
                onSubmit={(v) => createMut.mutate(v)}
              />
            </DialogContent>
          </Dialog>
        </div>

        {secretFlash && (
          <div className="mb-6 p-4 rounded-xl border border-profit/30 bg-profit/10 text-sm">
            <p className="font-medium text-profit mb-2">
              Signing secret (copy now; one-time display)
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
          <Card>
            <CardHeader>
              <CardTitle>No TV webhooks yet</CardTitle>
              <CardDescription>
                Create a webhook to get a signed URL and secret you can paste into
                a TradingView alert.
              </CardDescription>
            </CardHeader>
          </Card>
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
                        ? "border-primary bg-primary/10"
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
                The signing secret becomes invalid immediately. Any TradingView
                alert pointing to this URL will start returning 403. Delivery
                history is also removed.
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
  onDelete: () => void;
  rotating: boolean;
  patching: boolean;
  eventsQ: EventsQueryResult;
}) {
  const [marginDraft, setMarginDraft] = useState(String(webhook.maxMarginUsdt));
  useEffect(() => {
    setMarginDraft(String(webhook.maxMarginUsdt));
  }, [webhook.id, webhook.maxMarginUsdt]);

  const tvAlertTemplate = `{
  "idempotency_key": "{{strategy.order.id}}-{{timenow}}",
  "action": "open",
  "symbol": "{{ticker}}",
  "side": "LONG",
  "trigger_type": "MARKET"
}`;

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
              Rotate secret
            </Button>
          </div>

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
              <Label htmlFor="tv-max-margin" className="text-xs text-muted-foreground">
                Max margin per alert (USDT)
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  id="tv-max-margin"
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
                Hard cap on every manual-trade alert. Alerts may also send{" "}
                <code>qty: "25 USDT"</code> but we never exceed this cap.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">TradingView alert setup</CardTitle>
          <CardDescription>
            Paste the URL into the alert's "Webhook URL" field and use one of the
            templates below as the message body. The alert must also attach an{" "}
            <code className="text-xs">X-RexAlgo-Signature</code> header signed
            with your secret. TradingView cannot add headers directly — run the
            proxy script below on any host (Cloudflare Worker, Lambda, tiny VM)
            that signs and forwards the body.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-muted-foreground">
                Alert message body (JSON)
              </Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void copyText(tvAlertTemplate, "Template copied")}
              >
                <Copy className="w-3 h-3 mr-1" /> Copy
              </Button>
            </div>
            <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono">
              {tvAlertTemplate}
            </pre>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">
              Manual-trade trader template (accepts TV placeholders)
            </Label>
            <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono">
              {`{
  "id": "{{timenow}}",
  "ticker": "{{ticker}}",
  "action": "buy",
  "orderType": "market",
  "qty": "10 USDT"
}`}
            </pre>
            <p className="text-xs text-muted-foreground mt-1">
              <code>action</code>: <code>buy</code>/<code>sell</code>/
              <code>long</code>/<code>short</code>/<code>close</code>.{" "}
              <code>qty</code> accepts <code>"25 USDT"</code>; we clamp it to your
              max margin cap.
            </p>
          </div>
        </CardContent>
      </Card>

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
                    <th className="py-2 pr-2">Idempotency</th>
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
  onSubmit,
  loading,
  ownedStrategies,
  masterApproved,
}: {
  loading: boolean;
  ownedStrategies: Array<{ id: string; name: string; type: "algo" | "copy_trading" }>;
  masterApproved: boolean;
  onSubmit: (v: {
    name: string;
    mode: TvWebhookMode;
    strategyId?: string | null;
    maxMarginUsdt?: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<TvWebhookMode>("manual_trade");
  const [strategyId, setStrategyId] = useState<string>("");
  const [maxMargin, setMaxMargin] = useState("50");

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
        onSubmit({
          name: nm,
          mode,
          strategyId: mode === "route_to_strategy" ? strategyId : null,
          maxMarginUsdt:
            mode === "manual_trade" && Number.isFinite(marginNum) && marginNum > 0
              ? marginNum
              : undefined,
        });
      }}
    >
      <div>
        <Label htmlFor="tv-name">Name</Label>
        <Input
          id="tv-name"
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
        <div>
          <Label htmlFor="tv-margin">Max margin per alert (USDT)</Label>
          <Input
            id="tv-margin"
            type="number"
            min={1}
            step={1}
            value={maxMargin}
            onChange={(e) => setMaxMargin(e.target.value)}
            className="mt-1 font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Hard safety cap. Alerts that send <code>qty</code> are clamped to this
            value.
          </p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
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
