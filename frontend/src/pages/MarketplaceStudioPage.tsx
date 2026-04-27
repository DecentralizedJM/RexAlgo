import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useRequireMasterAccess } from "@/hooks/useAuth";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import {
  fetchMarketplaceStudioStrategies,
  createMarketplaceStudioStrategy,
  setMarketplaceStrategyWebhook,
  renameMarketplaceStrategyWebhook,
  fetchMarketplaceStrategySignals,
  patchStrategy,
  updateMarketplaceStudioStrategy,
  deleteMarketplaceStudioStrategy,
  resubmitMarketplaceStudioStrategy,
  submitMarketplaceStudioStrategyForReview,
  fetchMudrexAssets,
  fetchMarketplaceSlotRequests,
  requestMarketplaceSlots,
  type StudioStrategyRow,
  type StrategyReviewStatus,
  type MudrexAsset,
  ApiError,
} from "@/lib/api";
import StrategyBacktestPanel from "@/components/StrategyBacktestPanel";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  Pencil,
  Sparkles,
  RefreshCw,
  Power,
  PowerOff,
  Send,
  Trash2,
  Eye,
  EyeOff,
  AlertTriangle,
  ChevronsUpDown,
  X,
} from "lucide-react";

function StatusBadge({ status }: { status: StrategyReviewStatus }) {
  const map: Record<StrategyReviewStatus, { label: string; cls: string }> = {
    draft: { label: "Setup", cls: "bg-secondary text-muted-foreground" },
    pending: { label: "Pending review", cls: "bg-warning/15 text-warning" },
    approved: { label: "Approved", cls: "bg-profit/15 text-profit" },
    rejected: { label: "Rejected", cls: "bg-loss/15 text-loss" },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function buildWebhookUrl(
  publicBase: string | null,
  path: string,
  originFallback: string
): string {
  const base = (publicBase || originFallback).replace(/\/$/, "");
  return `${base}${path}`;
}

/** Studio APIs now return `/api/webhooks/strategy/:id`; normalize older saved paths. */
function canonicalStrategyWebhookPath(strategyId: string, path: string): string {
  if (path.includes("/api/webhooks/copy-trading/")) {
    return `/api/webhooks/strategy/${strategyId}`;
  }
  return path;
}

function appendWebhookSecret(url: string, secret: string): string {
  if (!url || !secret) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}secret=${encodeURIComponent(secret)}`;
}

function maskWebhookSecretUrl(url: string): string {
  return url.replace(/([?&]secret=)[^&]+/, "$1••••••••••••••••••••••••");
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

function strategySymbols(row: StudioStrategyRow | null | undefined): string[] {
  if (!row) return [];
  if (Array.isArray(row.symbols) && row.symbols.length > 0) return row.symbols;
  if (row.symbolsJson) {
    try {
      const parsed = JSON.parse(row.symbolsJson) as unknown;
      if (Array.isArray(parsed)) {
        const out = parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
        if (out.length > 0) return out;
      }
    } catch {
      /* fall through */
    }
  }
  return [row.symbol];
}

export default function MarketplaceStudioPage() {
  const authQ = useRequireMasterAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionAuthed = authQ.authed && authQ.masterApproved;
  const hasMudrexKey = authQ.data?.user?.hasMudrexKey ?? false;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secretFlash, setSecretFlash] = useState<{ strategyId: string; secret: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [approvedEditPatch, setApprovedEditPatch] = useState<Parameters<typeof updateMarketplaceStudioStrategy>[1] | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [webhookConfirm, setWebhookConfirm] = useState<{
    id: string;
    action: "enable" | "disable" | "rotate";
  } | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);

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
  const slots = studioQ.data?.slots ?? { used: 0, limit: 5 };
  const slotsFull = slots.used >= slots.limit;

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

  const slotRequestsQ = useQuery({
    queryKey: ["marketplace-studio", "slot-requests"],
    queryFn: fetchMarketplaceSlotRequests,
    enabled: sessionAuthed,
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
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["marketplace-studio", "strategies"] });
      if (data.secretPlain) {
        setSecretFlash({ strategyId: variables.id, secret: data.secretPlain });
        setSecretVisible(false);
      }
      setWebhookConfirm(null);
      if (variables.action === "enable") {
        toast.success("Webhook URL created", {
          description:
            "Copy the full URL into your bot. Treat it like a password — anyone with it can send signals for this strategy.",
        });
      }
    },
    onError: (e) => {
      if (e instanceof ApiError && e.body && typeof e.body === "object" && (e.body as { code?: string }).code === "RECENT_LOGIN_REQUIRED") {
        toast.error("Sign in again to confirm this webhook action.");
        navigate("/auth", { state: { from: "/marketplace/studio" } });
        return;
      }
      toast.error(e instanceof ApiError ? e.message : "Webhook update failed");
    },
  });

  const slotRequestMut = useMutation({
    mutationFn: requestMarketplaceSlots,
    onSuccess: async () => {
      toast.success("Slot request sent to admin");
      setSlotDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["marketplace-studio", "slot-requests"] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Slot request failed");
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameMarketplaceStrategyWebhook(id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["marketplace-studio", "strategies"],
      });
      setRenameDraft(null);
      toast.success("Webhook renamed");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Rename failed");
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

  const updateMut = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof updateMarketplaceStudioStrategy>[1];
    }) => updateMarketplaceStudioStrategy(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["marketplace-studio", "strategies"],
      });
      void queryClient.invalidateQueries({ queryKey: ["strategies", "algo"] });
      setEditOpen(false);
      setApprovedEditPatch(null);
      toast.success("Strategy updated");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Update failed");
    },
  });

  const resubmitMut = useMutation({
    mutationFn: (id: string) => resubmitMarketplaceStudioStrategy(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["marketplace-studio", "strategies"],
      });
      toast.success("Returned to setup — verify webhook, then submit for review");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Resubmit failed");
    },
  });

  const submitReviewMut = useMutation({
    mutationFn: (id: string) => submitMarketplaceStudioStrategyForReview(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["marketplace-studio", "strategies"],
      });
      void queryClient.invalidateQueries({ queryKey: ["strategies", "algo"] });
      toast.success("Submitted for admin review");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Submit failed");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMarketplaceStudioStrategy(id),
    onSuccess: () => {
      setDeleteOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ["marketplace-studio", "strategies"],
      });
      void queryClient.invalidateQueries({ queryKey: ["strategies", "algo"] });
      toast.success("Strategy deleted");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Delete failed");
    },
  });

  const webhookDisplayPath = selected
    ? canonicalStrategyWebhookPath(selected.id, selected.webhookPath)
    : "";
  const baseWebhookDisplayUrl = selected
    ? buildWebhookUrl(publicBase, webhookDisplayPath, originFallback)
    : "";
  const selectedGeneratedSecret =
    selected && secretFlash?.strategyId === selected.id ? secretFlash.secret : null;
  const webhookDisplayUrl = selectedGeneratedSecret
    ? appendWebhookSecret(baseWebhookDisplayUrl, selectedGeneratedSecret)
    : baseWebhookDisplayUrl;
  const webhookUrlInputValue =
    selectedGeneratedSecret && !secretVisible
      ? maskWebhookSecretUrl(webhookDisplayUrl)
      : webhookDisplayUrl;

  const canSubmitForAdminReview = useMemo(
    () =>
      Boolean(
        selected?.status === "draft" &&
          selected.webhookEnabled &&
          selected.webhookLastDeliveryAt
      ),
    [selected?.status, selected?.webhookEnabled, selected?.webhookLastDeliveryAt]
  );

  const pendingSlotRequest = (slotRequestsQ.data?.requests ?? []).find(
    (r) => r.status === "pending"
  );

  const exampleSymbol = strategySymbols(selected)[0] ?? "BTCUSDT";
  const pythonSnippet = selected
    ? `import json
import uuid
import urllib.request

# Paste the full URL from Strategy studio — it includes the secret (do not log or commit it).
WEBHOOK_URL = "<your full webhook URL from Strategy studio>"

body = {
    "idempotency_key": str(uuid.uuid4()),
    "action": "open",
    "symbol": "${exampleSymbol}",
    "side": "LONG",
    "trigger_type": "MARKET",
    # For LIMIT: set trigger_type to LIMIT and add "price": "65000"
    # Optional stops: "sl": "62000", "tp": "70000" (or stoplosPrice / takeprofitPrice)
    # To close: "action": "close", same symbol/side/trigger_type as the open
}
raw = json.dumps(body, separators=(",", ":"))

req = urllib.request.Request(
    WEBHOOK_URL,
    data=raw.encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as res:
    print(res.status, res.read().decode())`
    : "";

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
            {!hasMudrexKey && (
              <p className="mt-2 text-sm text-warning">
                Connect your API secret on the Dashboard to create new algo strategies.
              </p>
            )}
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1">
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="hero"
                  disabled={!hasMudrexKey || slotsFull}
                  title={
                    slotsFull
                      ? "You've hit the 5-listing limit. Delete a rejected listing or finish or remove a draft/pending listing to free a slot."
                      : undefined
                  }
                >
                  New algo strategy
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create algo strategy</DialogTitle>
                </DialogHeader>
                <AlgoCreateForm
                  loading={createMut.isPending}
                  onSubmit={(v) => createMut.mutate(v)}
                />
              </DialogContent>
            </Dialog>
            <p className="text-xs text-muted-foreground">
              Slots: <span className="font-medium text-foreground">{slots.used}</span>/
              {slots.limit} · rejected listings don&apos;t count
            </p>
            {slotsFull && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(pendingSlotRequest)}
                onClick={() => setSlotDialogOpen(true)}
              >
                {pendingSlotRequest ? "Slot request pending" : "Request more slots"}
              </Button>
            )}
          </div>
        </div>

        <Dialog open={slotDialogOpen} onOpenChange={setSlotDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Request more algo slots</DialogTitle>
            </DialogHeader>
            <SlotRequestForm
              loading={slotRequestMut.isPending}
              onSubmit={(v) => slotRequestMut.mutate(v)}
            />
          </DialogContent>
        </Dialog>

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
                      <StatusBadge status={s.status} />
                      {!s.isActive && (
                        <Badge variant="secondary" className="text-xs">
                          Paused
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {(s.assetMode === "multi" ? strategySymbols(s) : [s.symbol]).join(", ")}
                    </div>
                    <div className="text-xs mt-1 flex items-center gap-2">
                      <span
                        className={
                          s.webhookEnabled
                            ? "text-profit font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {s.webhookEnabled ? "webhook on" : "webhook off"}
                      </span>
                      {s.webhookLastDeliveryAt && (
                        <span className="text-muted-foreground">
                          · {formatRelative(s.webhookLastDeliveryAt)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            {selected && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 flex-wrap">
                          <span className="truncate">{selected.name}</span>
                          <StatusBadge status={selected.status} />
                        </CardTitle>
                        <CardDescription>{selected.description}</CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditOpen(true)}
                        >
                          <Pencil className="w-4 h-4 mr-1" /> Edit
                        </Button>
                        {selected.status === "rejected" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={resubmitMut.isPending}
                            onClick={() => resubmitMut.mutate(selected.id)}
                          >
                            <Send className="w-4 h-4 mr-1" /> Reapply
                          </Button>
                        )}
                        {selected.status === "draft" && (
                          <Button
                            type="button"
                            size="sm"
                            disabled={submitReviewMut.isPending || !canSubmitForAdminReview}
                            title={
                              !canSubmitForAdminReview
                                ? "Create the webhook URL, send a test signal, then submit."
                                : undefined
                            }
                            onClick={() => submitReviewMut.mutate(selected.id)}
                          >
                            {submitReviewMut.isPending ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4 mr-1" />
                            )}
                            Submit for admin review
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-loss hover:text-loss"
                          onClick={() => setDeleteOpen(true)}
                        >
                          <Trash2 className="w-4 h-4 mr-1" /> Delete
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selected.status === "draft" && (
                      <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm">
                        <p className="font-medium text-foreground">Setup: verify your webhook</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Create the webhook URL, paste it into TradingView or your bot, and send a test signal.
                          We record a delivery timestamp — then use <strong>Submit for admin review</strong> so the
                          team can approve your listing. Subscriber mirroring stays off until approved.
                        </p>
                      </div>
                    )}
                    {selected.status === "pending" && (
                      <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                        <p className="font-medium text-warning">Awaiting admin review</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Your listing is hidden from shoppers until an admin approves it. Webhook test traffic is
                          already on file; live mirroring to subscribers only runs once the listing is approved and
                          active.
                        </p>
                      </div>
                    )}
                    {selected.status === "rejected" && (
                      <div className="rounded-lg border border-loss/30 bg-loss/10 p-3 text-sm">
                        <p className="font-medium text-loss">Rejected</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {selected.rejectionReason?.trim()
                            ? selected.rejectionReason
                            : "No reason was provided. Edit the listing and reapply, or delete it."}
                        </p>
                      </div>
                    )}

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
                        disabled={
                          activeMut.isPending || selected.status !== "approved"
                        }
                        onCheckedChange={(checked) =>
                          activeMut.mutate({ id: selected.id, isActive: checked })
                        }
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-medium text-foreground">
                        {selected.assetMode === "multi" ? "Multi asset" : "Single asset"}:{" "}
                        {strategySymbols(selected).join(", ")}
                      </span>
                      {selected.webhookEnabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-profit/15 text-profit px-2 py-0.5 font-medium">
                          <Check className="w-3 h-3" /> webhook active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground px-2 py-0.5 font-medium">
                          webhook disabled
                        </span>
                      )}
                      <span>
                        Last delivery:{" "}
                        {selected.webhookLastDeliveryAt
                          ? new Date(selected.webhookLastDeliveryAt).toLocaleString()
                          : "—"}
                      </span>
                      {selected.webhookRotatedAt && (
                        <span>
                          Rotated:{" "}
                          {new Date(selected.webhookRotatedAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    <div className="border-t border-border pt-4 space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Your signal webhook</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Generated for this strategy only. The full URL contains the secret, so keep it private.
                        </p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Webhook name
                      </Label>
                      {renameDraft !== null ? (
                        <div className="flex gap-2 mt-1">
                          <Input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const v = renameDraft.trim();
                                if (v) renameMut.mutate({ id: selected.id, name: v });
                              } else if (e.key === "Escape") {
                                setRenameDraft(null);
                              }
                            }}
                            maxLength={120}
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            disabled={renameMut.isPending || !renameDraft.trim()}
                            onClick={() => {
                              const v = renameDraft.trim();
                              if (v) renameMut.mutate({ id: selected.id, name: v });
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
                          <span className="text-sm font-medium">
                            {selected.webhookName ?? selected.name}
                          </span>
                          {selected.webhookEnabled && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() =>
                                setRenameDraft(selected.webhookName ?? selected.name)
                              }
                              aria-label="Rename webhook"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                      {!selected.webhookEnabled && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Enable the webhook to rename it.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          webhookMut.isPending ||
                          selected.webhookEnabled ||
                          selected.status === "rejected"
                        }
                        title={
                          selected.status === "rejected"
                            ? "Resubmit from the studio before enabling the webhook."
                            : undefined
                        }
                        onClick={() => setWebhookConfirm({ id: selected.id, action: "enable" })}
                      >
                        <Power className="w-4 h-4 mr-1" />
                        Create webhook URL
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={webhookMut.isPending || !selected.webhookEnabled}
                        onClick={() => setWebhookConfirm({ id: selected.id, action: "disable" })}
                      >
                        <PowerOff className="w-4 h-4 mr-1" />
                        Disable
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={webhookMut.isPending || selected.status === "rejected"}
                        title={
                          selected.status === "rejected"
                            ? "Resubmit from the studio before rotating the webhook."
                            : undefined
                        }
                        onClick={() => setWebhookConfirm({ id: selected.id, action: "rotate" })}
                      >
                        <RefreshCw className="w-4 h-4 mr-1" />
                        Regenerate URL
                      </Button>
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">Webhook URL</Label>
                      <div className="flex gap-2 mt-1">
                        <Input readOnly value={webhookUrlInputValue} className="font-mono text-xs" />
                        {selectedGeneratedSecret && (
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            onClick={() => setSecretVisible((v) => !v)}
                            aria-label={secretVisible ? "Hide webhook URL secret" : "Reveal webhook URL secret"}
                          >
                            {secretVisible ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className={cn("w-4 h-4 animate-pulse")} aria-hidden />
                            )}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => void copyText(webhookDisplayUrl, "Webhook URL copied")}
                          aria-label="Copy webhook URL"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                      {!selected.webhookEnabled && selected.status !== "rejected" && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Create the webhook URL to get a secret link, then send a test signal. After we show a last
                          delivery time, submit for admin review from the header.
                        </p>
                      )}
                      <p className="text-xs text-warning mt-2">
                        This full URL is the secret. Do not share it publicly. If it leaks, anyone with the URL can
                        send signals that manage this strategy. Regenerate the URL immediately if exposed.
                      </p>
                      {!selectedGeneratedSecret && selected.webhookEnabled && (
                        <p className="text-xs text-muted-foreground mt-1">
                          For security, the full secret URL is only shown right after creation or regeneration.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <StrategyBacktestPanel
                  strategyId={selected.id}
                  strategyName={selected.name}
                />

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Signal format (JSON)</CardTitle>
                    <CardDescription>
                      Required on every signal:{" "}
                      <code className="text-xs">idempotency_key</code>,{" "}
                      <code className="text-xs">action</code> (<code className="text-xs">open</code> |{" "}
                      <code className="text-xs">close</code>),{" "}
                      <code className="text-xs">symbol</code>,{" "}
                      <code className="text-xs">side</code> (<code className="text-xs">LONG</code> |{" "}
                      <code className="text-xs">SHORT</code>),{" "}
                      <code className="text-xs">trigger_type</code> (<code className="text-xs">MARKET</code> |{" "}
                      <code className="text-xs">LIMIT</code>). For <code className="text-xs">LIMIT</code>,{" "}
                      <code className="text-xs">price</code> is required. Optional stops:{" "}
                      <code className="text-xs">sl</code> / <code className="text-xs">tp</code> (or{" "}
                      <code className="text-xs">stoplosPrice</code>, <code className="text-xs">takeprofitPrice</code>
                      ). Authentication is the secret in your webhook URL (not in this JSON).
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono">
{`{
  "idempotency_key": "uuid-v4",
  "action": "open",
  "symbol": "${strategySymbols(selected)[0] ?? "BTCUSDT"}",
  "side": "LONG",
  "trigger_type": "MARKET"
}

{
  "idempotency_key": "uuid-v4-with-stops",
  "action": "open",
  "symbol": "${strategySymbols(selected)[0] ?? "BTCUSDT"}",
  "side": "LONG",
  "trigger_type": "MARKET",
  "sl": "62000",
  "tp": "70000"
}

{
  "idempotency_key": "uuid-v4-limit-short",
  "action": "open",
  "symbol": "${strategySymbols(selected)[0] ?? "BTCUSDT"}",
  "side": "SHORT",
  "trigger_type": "LIMIT",
  "price": "65000"
}

{
  "idempotency_key": "uuid-v4-close",
  "action": "close",
  "symbol": "${strategySymbols(selected)[0] ?? "BTCUSDT"}",
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
                      onClick={() => void copyText(pythonSnippet, "Snippet copied")}
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
                              <th className="py-2 pr-2">Signal</th>
                              <th className="py-2 pr-2">Idempotency</th>
                              <th className="py-2 pr-2">Status</th>
                              <th className="py-2 pr-2">Error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {signalsQ.data!.signals.map((row) => {
                              const s = row.summary;
                              return (
                                <tr key={row.id} className="border-b border-border/50 align-top">
                                  <td className="py-2 pr-2 font-mono text-xs whitespace-nowrap">
                                    {new Date(row.receivedAt).toLocaleString()}
                                  </td>
                                  <td className="py-2 pr-2 text-xs">
                                    <span className="font-medium">{String(s?.action ?? "—").toUpperCase()}</span>{" "}
                                    <span className="font-mono">{String(s?.side ?? "—")} {String(s?.symbol ?? "—")}</span>
                                    <span className="ml-1 text-muted-foreground">{String(s?.triggerType ?? "—")}</span>
                                  </td>
                                  <td className="py-2 pr-2 font-mono text-xs truncate max-w-[140px]">
                                    {row.idempotencyKey}
                                  </td>
                                  <td className="py-2 pr-2 whitespace-nowrap">
                                    <span className="text-profit">{row.mirror.ok}</span>
                                    {" / "}
                                    <span className="text-loss">{row.mirror.err}</span>
                                  </td>
                                  <td className="py-2 pr-2 max-w-[220px] truncate text-xs text-loss">
                                    {row.mirror.lastError ?? "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  Futures trading is high risk. Mirroring can fail per subscriber. Not financial advice.
                </p>

                <Dialog open={editOpen} onOpenChange={setEditOpen}>
                  <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Edit algo strategy</DialogTitle>
                    </DialogHeader>
                    <EditAlgoForm
                      initial={selected}
                      loading={updateMut.isPending}
                      onSubmit={(patch) => {
                        if (selected.status === "approved") {
                          setApprovedEditPatch(patch);
                          return;
                        }
                        updateMut.mutate({ id: selected.id, patch });
                      }}
                    />
                  </DialogContent>
                </Dialog>

                <AlertDialog
                  open={Boolean(approvedEditPatch)}
                  onOpenChange={(open) => !open && setApprovedEditPatch(null)}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Edit approved strategy?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Saving changes to an approved strategy returns it to setup (draft) and disables the webhook.
                        Send a test signal again, then submit for admin review. It stays hidden from the marketplace
                        until re-approved.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={updateMut.isPending || !approvedEditPatch}
                        onClick={(e) => {
                          e.preventDefault();
                          if (approvedEditPatch) {
                            updateMut.mutate({ id: selected.id, patch: approvedEditPatch });
                          }
                        }}
                      >
                        {updateMut.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Save and send to review"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this listing?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes &quot;{selected.name}&quot; from your studio, cancels any
                        webhook config, and unsubscribes active subscribers if any exist.
                        {selected.status === "approved"
                          ? " This strategy is currently approved and public, so deleting it will immediately remove it from the marketplace."
                          : ""}{" "}
                        This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          deleteMut.mutate(selected.id);
                        }}
                        disabled={deleteMut.isPending}
                        className="bg-loss hover:bg-loss/90"
                      >
                        {deleteMut.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Delete"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog open={Boolean(webhookConfirm)} onOpenChange={(open) => !open && setWebhookConfirm(null)}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm webhook action</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action changes access to your strategy webhook URL. The full URL contains the secret;
                        if it leaks, anyone can send signals for this strategy. You may be asked to sign in again
                        before the server accepts this action.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                      <AlertTriangle className="mr-2 inline h-4 w-4" />
                      Keep the full webhook URL private.
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={webhookMut.isPending || !webhookConfirm}
                        onClick={(e) => {
                          e.preventDefault();
                          if (webhookConfirm) webhookMut.mutate(webhookConfirm);
                        }}
                      >
                        {webhookMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SymbolSelector({
  assetMode,
  setAssetMode,
  symbols,
  setSymbols,
}: {
  assetMode: "single" | "multi";
  setAssetMode: (v: "single" | "multi") => void;
  symbols: string[];
  setSymbols: (v: string[]) => void;
}) {
  const [manual, setManual] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const assetsQ = useQuery({
    queryKey: ["mudrex", "assets", "studio"],
    queryFn: () => fetchMudrexAssets(),
    staleTime: 5 * 60_000,
  });
  const assets = (assetsQ.data?.assets ?? []).filter((a) => a.is_active !== false);
  const sortedAssets = useMemo(
    () => [...assets].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [assets]
  );

  const addSymbol = useCallback(
    (symbol: string) => {
      const s = symbol.trim().toUpperCase();
      if (!s) return;
      setSymbols(Array.from(new Set(assetMode === "single" ? [s] : [...symbols, s])));
      setManual("");
      if (assetMode === "single") setPickerOpen(false);
    },
    [assetMode, setSymbols, symbols]
  );

  const triggerLabel =
    assetMode === "single"
      ? symbols[0] ?? "Search or choose symbol…"
      : "Search symbols to add…";

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div>
        <Label>Asset mode</Label>
        <Select value={assetMode} onValueChange={(v) => {
          const next = v as "single" | "multi";
          setAssetMode(next);
          if (next === "single") setSymbols([symbols[0] ?? "BTCUSDT"]);
        }}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Single asset</SelectItem>
            <SelectItem value="multi">Multi asset</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Mudrex symbols</Label>
        {assetsQ.isLoading && assets.length === 0 ? (
          <div className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Loading symbols…
          </div>
        ) : assets.length > 0 ? (
          <div className="space-y-2">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="w-full justify-between font-normal min-h-10 h-auto py-2"
                >
                  <span
                    className={cn(
                      "truncate text-left",
                      assetMode === "single" && symbols[0] ? "font-mono text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {triggerLabel}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0 min-w-[min(100vw-2rem,22rem)] max-w-[min(100vw-2rem,28rem)]"
                align="start"
              >
                <Command shouldFilter>
                  <CommandInput placeholder="Search by symbol (e.g. BTC, ETH)…" className="font-mono" />
                  <CommandList>
                    <CommandEmpty>No matching symbol.</CommandEmpty>
                    <CommandGroup>
                      {sortedAssets.map((a: MudrexAsset) => {
                        const selected = symbols.includes(a.symbol);
                        const disabled = assetMode === "multi" && selected;
                        return (
                          <CommandItem
                            key={a.symbol}
                            value={a.symbol}
                            keywords={[
                              a.base_currency,
                              a.quote_currency,
                              `${a.base_currency}${a.quote_currency}`,
                            ].filter((x): x is string => Boolean(x && String(x).trim()))}
                            disabled={disabled}
                            className="font-mono"
                            onSelect={() => {
                              if (!disabled) addSymbol(a.symbol);
                            }}
                          >
                            <span className="flex-1 truncate">{a.symbol}</span>
                            {assetMode === "single" && symbols[0] === a.symbol ? (
                              <Check className="h-4 w-4 shrink-0 text-primary" />
                            ) : null}
                            {assetMode === "multi" && selected ? (
                              <span className="text-xs text-muted-foreground shrink-0">added</span>
                            ) : null}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Open the picker to search the full Mudrex list, or type a symbol below.
            </p>
            <div className="flex gap-2">
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSymbol(manual);
                  }
                }}
                placeholder="Type symbol (e.g. BTCUSDT)"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={() => addSymbol(manual)}>
                {assetMode === "single" ? "Set" : "Add"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="BTCUSDT"
              className="font-mono"
            />
            <Button type="button" variant="outline" onClick={() => addSymbol(manual)}>
              {assetMode === "single" ? "Set" : "Add"}
            </Button>
          </div>
        )}
        {assetsQ.isError && (
          <p className="text-xs text-warning">
            Could not load Mudrex symbols. You can type one; the server will still validate it.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {symbols.map((s) => (
            <Badge key={s} variant="secondary" className="gap-1 font-mono">
              {s}
              {assetMode === "multi" && symbols.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove ${s}`}
                  onClick={() => setSymbols(symbols.filter((x) => x !== s))}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Symbols are validated against your Mudrex Futures account before save.
        </p>
      </div>
    </div>
  );
}

function SlotRequestForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (v: { requestedSlots: number; note?: string }) => void;
}) {
  const [requestedSlots, setRequestedSlots] = useState("1");
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          requestedSlots: Math.max(1, parseInt(requestedSlots, 10) || 1),
          note: note.trim() || undefined,
        });
      }}
    >
      <div>
        <Label htmlFor="slot-count">Additional slots</Label>
        <Input
          id="slot-count"
          type="number"
          min={1}
          max={20}
          value={requestedSlots}
          onChange={(e) => setRequestedSlots(e.target.value)}
          className="mt-1 font-mono"
        />
      </div>
      <div>
        <Label htmlFor="slot-note">Why do you need more?</Label>
        <Textarea
          id="slot-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 min-h-[100px]"
          placeholder="Share what you plan to publish so admins can review faster."
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send request"}
      </Button>
    </form>
  );
}

function EditAlgoForm({
  initial,
  onSubmit,
  loading,
}: {
  initial: StudioStrategyRow;
  loading: boolean;
  onSubmit: (patch: Parameters<typeof updateMarketplaceStudioStrategy>[1]) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [assetMode, setAssetMode] = useState<"single" | "multi">(
    initial.assetMode === "multi" ? "multi" : "single"
  );
  const [symbols, setSymbols] = useState<string[]>(strategySymbols(initial));
  const [side, setSide] = useState<"LONG" | "SHORT" | "BOTH">(
    (initial.side as "LONG" | "SHORT" | "BOTH") ?? "BOTH"
  );
  const [leverage, setLeverage] = useState(initial.leverage ?? "1");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">(
    initial.riskLevel
  );
  const [timeframe, setTimeframe] = useState(initial.timeframe ?? "1h");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !description.trim() || symbols.length === 0) return;
        onSubmit({
          name: name.trim(),
          description: description.trim(),
          assetMode,
          symbol: symbols[0]!,
          symbols,
          side,
          leverage,
          riskLevel,
          timeframe,
        });
      }}
    >
      <div>
        <Label htmlFor="edit-ms-name">Name</Label>
        <Input
          id="edit-ms-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1"
          required
        />
      </div>
      <div>
        <Label htmlFor="edit-ms-desc">Description</Label>
        <Textarea
          id="edit-ms-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 min-h-[100px]"
          required
        />
      </div>
      <SymbolSelector
        assetMode={assetMode}
        setAssetMode={setAssetMode}
        symbols={symbols}
        setSymbols={setSymbols}
      />
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
        <Label htmlFor="edit-ms-lev">Leverage</Label>
        <Input
          id="edit-ms-lev"
          value={leverage}
          onChange={(e) => setLeverage(e.target.value)}
          className="mt-1 font-mono"
        />
      </div>
      <div>
        <Label>Risk</Label>
        <Select
          value={riskLevel}
          onValueChange={(v) => setRiskLevel(v as typeof riskLevel)}
        >
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
        <Label htmlFor="edit-ms-tf">Timeframe</Label>
        <Input
          id="edit-ms-tf"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          className="mt-1"
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
      </Button>
    </form>
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
    assetMode: "single" | "multi";
    symbols: string[];
    side: "LONG" | "SHORT" | "BOTH";
    leverage: string;
    riskLevel: "low" | "medium" | "high";
    timeframe: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assetMode, setAssetMode] = useState<"single" | "multi">("single");
  const [symbols, setSymbols] = useState<string[]>(["BTCUSDT"]);
  const [side, setSide] = useState<"LONG" | "SHORT" | "BOTH">("BOTH");
  const [leverage, setLeverage] = useState("5");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">("medium");
  const [timeframe, setTimeframe] = useState("1h");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !description.trim() || symbols.length === 0) return;
        if (assetMode === "multi" && symbols.length < 2) {
          toast.error("Choose at least two symbols for a multi-asset strategy.");
          return;
        }
        onSubmit({
          name: name.trim(),
          description: description.trim(),
          assetMode,
          symbol: symbols[0]!,
          symbols,
          side,
          leverage,
          riskLevel,
          timeframe,
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
      <SymbolSelector
        assetMode={assetMode}
        setAssetMode={setAssetMode}
        symbols={symbols}
        setSymbols={setSymbols}
      />
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
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
      </Button>
    </form>
  );
}
