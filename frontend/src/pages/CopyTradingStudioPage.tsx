import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
import { useRequireMasterAccess } from "@/hooks/useAuth";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import StrategyBacktestPanel from "@/components/StrategyBacktestPanel";
import StudioBacktestUploader from "@/components/studio/StudioBacktestUploader";
import StudioSubmitChecklist from "@/components/studio/StudioSubmitChecklist";
import {
  fetchCopyStudioStrategies,
  createCopyStudioStrategy,
  setCopyStrategyWebhook,
  renameCopyStrategyWebhook,
  fetchCopyStrategySignals,
  updateCopyStudioStrategy,
  deleteCopyStudioStrategy,
  resubmitCopyStudioStrategy,
  submitCopyStudioStrategyForReview,
  type StudioStrategyRow,
  type StrategyReviewStatus,
  ApiError,
} from "@/lib/api";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  isStrategyDescriptionValid,
  MIN_STRATEGY_DESCRIPTION_CHARS,
  strategyDescriptionLength,
} from "@/lib/strategyValidation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  Pencil,
  UserCog,
  RefreshCw,
  Power,
  PowerOff,
  Eye,
  EyeOff,
  Send,
  Trash2,
  X,
} from "lucide-react";

/**
 * Small status pill used in the list and detail header. Colours echo the
 * existing profit/warning/loss tokens so we don't introduce new palette
 * entries.
 */
function StatusBadge({ status }: { status: StrategyReviewStatus }) {
  const map: Record<StrategyReviewStatus, { label: string; cls: string }> = {
    draft: {
      label: "Setup",
      cls: "bg-secondary text-muted-foreground",
    },
    pending: {
      label: "Pending review",
      cls: "bg-warning/15 text-warning",
    },
    on_hold: {
      label: "Check later",
      cls: "bg-secondary text-muted-foreground",
    },
    approved: {
      label: "Approved",
      cls: "bg-profit/15 text-profit",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-loss/15 text-loss",
    },
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

/** Compact relative timestamp for webhook last-delivery hints (e.g. "3m ago"). */
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

export default function CopyTradingStudioPage() {
  const authQ = useRequireMasterAccess();
  const queryClient = useQueryClient();
  const sessionAuthed = authQ.authed && authQ.masterApproved;
  const hasMudrexKey = authQ.data?.user?.hasMudrexKey ?? false;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secretFlash, setSecretFlash] = useState<{ strategyId: string; secret: string } | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const signalEndpointRef = useRef<HTMLDivElement | null>(null);
  const backtestSectionRef = useRef<HTMLDivElement | null>(null);
  const signalTestRef = useRef<HTMLDivElement | null>(null);
  const [highlightSection, setHighlightSection] = useState<
    "webhook" | "backtest" | "signal" | null
  >(null);
  /**
   * Mirrors the marketplace studio: when the creator clicks "I'm sending the
   * test signal now" inside `StudioSubmitChecklist`, we briefly switch the
   * studio strategies query into a fast-poll mode so the checklist can flip
   * to "Signal received" without waiting for the default 15s stale window.
   */
  const [signalListeningSince, setSignalListeningSince] = useState<number | null>(
    null
  );

  const originFallback =
    typeof window !== "undefined" ? `${window.location.origin}` : "";

  /**
   * Fast-poll window: 4s cadence for up to 3 minutes after the creator
   * clicks "I'm sending the test signal now" inside the checklist. Once a
   * delivery is recorded (or the 3 min hard ceiling fires) we drop back to
   * the default 15s stale window so the studio doesn't hammer the backend.
   */
  const FAST_POLL_WINDOW_MS = 3 * 60_000;
  const fastPollActive = signalListeningSince !== null;
  const studioRefetchInterval = fastPollActive ? 4_000 : false;

  const scrollToSection = useCallback(
    (section: "webhook" | "backtest" | "signal") => {
      const ref =
        section === "webhook"
          ? signalEndpointRef
          : section === "backtest"
            ? backtestSectionRef
            : signalTestRef;
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightSection(section);
      window.setTimeout(() => setHighlightSection(null), 2_000);
    },
    []
  );

  const studioQ = useQuery({
    queryKey: ["copy-studio", "strategies"],
    queryFn: fetchCopyStudioStrategies,
    enabled: sessionAuthed,
    ...liveDataQueryOptions,
    refetchInterval: studioRefetchInterval,
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

  // Stop fast-polling once we observe a recorded delivery on the selected
  // strategy. Without this we would keep hitting the API every 4s after the
  // checklist already turned green.
  useEffect(() => {
    if (!fastPollActive) return;
    if (selected?.webhookLastDeliveryAt) {
      setSignalListeningSince(null);
    }
  }, [fastPollActive, selected?.webhookLastDeliveryAt]);

  // Hard ceiling on the fast-poll window in case the test signal never
  // arrives (misconfigured TradingView alert, wrong URL, etc.).
  useEffect(() => {
    if (signalListeningSince === null) return;
    const elapsed = Date.now() - signalListeningSince;
    const remaining = Math.max(0, FAST_POLL_WINDOW_MS - elapsed);
    const timer = window.setTimeout(() => {
      setSignalListeningSince(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [signalListeningSince]);

  // Reset listening when the creator switches strategies.
  useEffect(() => {
    setSignalListeningSince(null);
  }, [selectedId]);

  const signalsQ = useQuery({
    queryKey: ["copy-studio", "signals", selectedId],
    queryFn: () => fetchCopyStrategySignals(selectedId!),
    enabled: sessionAuthed && Boolean(selectedId),
    ...liveDataQueryOptions,
  });

  const createMut = useMutation({
    mutationFn: createCopyStudioStrategy,
    onSuccess: (data) => {
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
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["copy-studio", "strategies"] });
      if (data.secretPlain) {
        setSecretFlash({ strategyId: variables.id, secret: data.secretPlain });
        setSecretVisible(false);
      }
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Webhook update failed");
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameCopyStrategyWebhook(id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["copy-studio", "strategies"] });
      setRenameDraft(null);
      toast.success("Webhook renamed");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Rename failed");
    },
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof updateCopyStudioStrategy>[1];
    }) => updateCopyStudioStrategy(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["copy-studio", "strategies"],
      });
      setEditOpen(false);
      toast.success("Strategy updated");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Update failed");
    },
  });

  const resubmitMut = useMutation({
    mutationFn: (id: string) => resubmitCopyStudioStrategy(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["copy-studio", "strategies"],
      });
      toast.success("Returned to setup — verify webhook, then submit for review");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Resubmit failed");
    },
  });

  const submitReviewMut = useMutation({
    mutationFn: (id: string) => submitCopyStudioStrategyForReview(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["copy-studio", "strategies"],
      });
      toast.success("Submitted for admin review");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Submit failed");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCopyStudioStrategy(id),
    onSuccess: () => {
      setDeleteOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ["copy-studio", "strategies"],
      });
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
  /**
   * `true` once the creator has run "Create webhook URL" at least once for
   * this strategy. Mirrors the marketplace twin — see
   * `frontend/src/pages/MarketplaceStudioPage.tsx` for the rationale and
   * `backend/src/app/api/copy-trading/studio/strategies/route.ts` for the
   * server-side flag.
   */
  const hasWebhookEndpoint = Boolean(
    selected &&
      (selected.webhookConfigured ||
        selected.webhookEnabled ||
        selectedGeneratedSecret)
  );

  // Reset reveal toggle when switching strategies — secrets are
  // per-strategy and a stale "revealed" flag would leak across rows.
  useEffect(() => {
    setSecretVisible(false);
  }, [selectedId]);

  const copyExampleSymbol = selected?.symbol?.trim().toUpperCase() || "BTCUSDT";
  const pythonSnippet = selected
    ? `import json
import urllib.request

# Paste the full URL from Copy trading studio — it includes the secret (do not log or commit it).
WEBHOOK_URL = "<your full webhook URL from Copy trading studio>"

body = {
    "idempotency_key": "unique-per-signal-uuid",
    "action": "open",
    "symbol": "${copyExampleSymbol}",
    "side": "LONG",
    "trigger_type": "MARKET",
    # For LIMIT: "trigger_type": "LIMIT", "price": "65000"
    # Optional: "sl", "tp" (or stoplosPrice / takeprofitPrice)
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
              to="/copy-trading"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3"
            >
              <ArrowLeft className="w-4 h-4" /> Back to copy trading
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <UserCog className="w-7 h-7 text-primary" />
              Copy trading studio
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              List a copy strategy, enable the webhook, and POST signals from your bot. Subscribers mirror
              into their Mudrex accounts.
            </p>
            {!hasMudrexKey && (
              <p className="mt-2 text-sm text-warning">
                Connect your API secret on the Dashboard to create new copy-trading strategies.
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
                  New copy strategy
                </Button>
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
            <p className="text-xs text-muted-foreground">
              Slots: <span className="font-medium text-foreground">{slots.used}</span>/
              {slots.limit} · rejected listings don&apos;t count
            </p>
          </div>
        </div>

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
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate flex-1 min-w-0">
                        {s.name}
                      </span>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{s.symbol}</div>
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
                        {selected.status !== "approved" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditOpen(true)}
                          >
                            <Pencil className="w-4 h-4 mr-1" /> Edit
                          </Button>
                        )}
                        {/*
                          Reapply / Submit-for-review live inside
                          StudioSubmitChecklist below — keeps the action
                          attached to the steps that explain when it is
                          unlocked.
                        */}
                        {selected.status !== "approved" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-loss hover:text-loss"
                            onClick={() => setDeleteOpen(true)}
                          >
                            <Trash2 className="w-4 h-4 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(selected.status === "draft" ||
                      selected.status === "rejected") && (
                      <StudioSubmitChecklist
                        status={selected.status}
                        webhookConfigured={selected.webhookConfigured}
                        webhookEnabled={selected.webhookEnabled}
                        webhookLastDeliveryAt={selected.webhookLastDeliveryAt}
                        hasBacktest={Boolean(selected.backtestUpload)}
                        rejectionReason={selected.rejectionReason}
                        submitting={submitReviewMut.isPending}
                        onSubmit={() => submitReviewMut.mutate(selected.id)}
                        onReapply={() => resubmitMut.mutate(selected.id)}
                        reapplying={resubmitMut.isPending}
                        onSignalListenStart={() => setSignalListeningSince(Date.now())}
                        onGoToWebhook={() => scrollToSection("webhook")}
                        onGoToBacktest={() => scrollToSection("backtest")}
                        onGoToSignalFormatExample={() => scrollToSection("signal")}
                        listeningWindowMs={FAST_POLL_WINDOW_MS}
                      />
                    )}
                    {selected.status === "pending" && (
                      <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                        <p className="font-medium text-warning">Awaiting admin review</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Your listing is hidden from subscribers until an admin approves it. Test traffic is on file;
                          live mirroring only runs once the listing is approved.
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {hasWebhookEndpoint && (
                        <>
                          {selected.webhookEnabled ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-profit/15 text-profit px-2 py-0.5 font-medium">
                              <Check className="w-3 h-3" /> webhook active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning px-2 py-0.5 font-medium">
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
                        </>
                      )}
                    </div>

                    <div
                      ref={signalEndpointRef}
                      className={cn(
                        "scroll-mt-24 rounded-xl border border-border bg-secondary/20 p-4 transition-shadow",
                        highlightSection === "webhook" &&
                          "ring-2 ring-primary/60 shadow-lg shadow-primary/10"
                      )}
                    >
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Step action happens here
                        </p>
                        <h3 className="text-lg font-semibold text-foreground">
                          Signal endpoint
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          RexAlgo creates a private API endpoint for this strategy.
                          Paste it into TradingView or your bot so RexAlgo can listen
                          for your signals and mirror them to subscribers after admin
                          approval.
                        </p>
                      </div>
                    </div>

                    {/*
                      Webhook label (rename) only after creation — see the
                      marketplace twin for the rationale.
                    */}
                    {hasWebhookEndpoint && (
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
                            Re-enable the webhook (Regenerate URL) to rename it.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {!hasWebhookEndpoint ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={
                            webhookMut.isPending || selected.status === "rejected"
                          }
                          title={
                            selected.status === "rejected"
                              ? "Resubmit from the studio before creating the webhook."
                              : undefined
                          }
                          onClick={() =>
                            webhookMut.mutate({ id: selected.id, action: "enable" })
                          }
                        >
                          <Power className="w-4 h-4 mr-1" />
                          Create webhook URL
                        </Button>
                      ) : (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              webhookMut.isPending || selected.status === "rejected"
                            }
                            title={
                              selected.status === "rejected"
                                ? "Resubmit from the studio before rotating the webhook."
                                : undefined
                            }
                            onClick={() =>
                              webhookMut.mutate({ id: selected.id, action: "rotate" })
                            }
                          >
                            <RefreshCw className="w-4 h-4 mr-1" />
                            Regenerate URL
                          </Button>
                          {selected.webhookEnabled && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={webhookMut.isPending}
                              onClick={() =>
                                webhookMut.mutate({
                                  id: selected.id,
                                  action: "disable",
                                })
                              }
                            >
                              <PowerOff className="w-4 h-4 mr-1" />
                              Disable
                            </Button>
                          )}
                        </>
                      )}
                    </div>

                    {hasWebhookEndpoint && (
                      selectedGeneratedSecret ? (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Webhook URL
                          </Label>
                          <div className="flex gap-2 mt-1">
                            <Input
                              readOnly
                              value={webhookUrlInputValue}
                              className="font-mono text-xs"
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              onClick={() => setSecretVisible((v) => !v)}
                              aria-label={
                                secretVisible
                                  ? "Hide webhook URL secret"
                                  : "Reveal webhook URL secret"
                              }
                            >
                              {secretVisible ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye
                                  className={cn("w-4 h-4 animate-pulse")}
                                  aria-hidden
                                />
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              onClick={() => {
                                // Reveal-on-copy so the creator can sanity
                                // check the value before pasting it into
                                // TradingView/their bot.
                                setSecretVisible(true);
                                void copyText(
                                  webhookDisplayUrl,
                                  "Webhook URL copied"
                                );
                              }}
                              aria-label="Copy webhook URL"
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                          </div>
                          <p className="text-xs text-warning mt-2">
                            This URL contains a secret. Keep it private; if it
                            leaks, anyone with the URL can send signals for this
                            strategy. Regenerate it immediately if exposed.
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Dev tip: expose{" "}
                            <code className="text-foreground/80">127.0.0.1:3000</code>{" "}
                            with ngrok; bots cannot call Vite on 8080 unless you proxy
                            webhooks there too.
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground leading-relaxed">
                          <p className="font-medium text-foreground mb-1">
                            Endpoint configured — full URL hidden
                          </p>
                          <p>
                            For security, the secret in the webhook URL is only
                            revealed right after creation or regeneration.{" "}
                            {selected.webhookEnabled
                              ? ""
                              : "This endpoint is currently disabled. "}
                            Click{" "}
                            <span className="font-medium text-foreground">
                              Regenerate URL
                            </span>{" "}
                            to mint a fresh secret you can copy.
                          </p>
                        </div>
                      )
                    )}
                  </CardContent>
                </Card>

                <div
                  ref={backtestSectionRef}
                  className={cn(
                    "scroll-mt-24 rounded-xl transition-shadow",
                    highlightSection === "backtest" &&
                      "ring-2 ring-primary/60 shadow-lg shadow-primary/10"
                  )}
                >
                  <StudioBacktestUploader
                    strategyId={selected.id}
                    strategyType="copy_trading"
                    current={selected.backtestUpload ?? null}
                    onUploaded={() => {
                      void queryClient.invalidateQueries({
                        queryKey: ["copy-studio", "strategies"],
                      });
                    }}
                  />
                </div>

                <StrategyBacktestPanel
                  strategyName={selected.name}
                  upload={selected.backtestUpload ?? null}
                />

                <Card
                  ref={signalTestRef}
                  className={cn(
                    "scroll-mt-24 transition-shadow",
                    highlightSection === "signal" &&
                      "ring-2 ring-primary/60 shadow-lg shadow-primary/10"
                  )}
                >
                  <CardHeader>
                    <CardTitle className="text-base">Signal format (JSON)</CardTitle>
                    <CardDescription>
                      Required:{" "}
                      <code className="text-xs">idempotency_key</code>,{" "}
                      <code className="text-xs">action</code> (<code className="text-xs">open</code> |{" "}
                      <code className="text-xs">close</code>),{" "}
                      <code className="text-xs">symbol</code>,{" "}
                      <code className="text-xs">side</code> (<code className="text-xs">LONG</code> |{" "}
                      <code className="text-xs">SHORT</code>),{" "}
                      <code className="text-xs">trigger_type</code> (<code className="text-xs">MARKET</code> |{" "}
                      <code className="text-xs">LIMIT</code>). For <code className="text-xs">LIMIT</code>,{" "}
                      <code className="text-xs">price</code> is required. Optional:{" "}
                      <code className="text-xs">sl</code> / <code className="text-xs">tp</code>. Auth is the secret in
                      your webhook URL.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-secondary/50 p-4 rounded-lg overflow-x-auto font-mono">
{`{
  "idempotency_key": "uuid-v4",
  "action": "open",
  "symbol": "${copyExampleSymbol}",
  "side": "LONG",
  "trigger_type": "MARKET"
}

{
  "idempotency_key": "uuid-v4-limit",
  "action": "open",
  "symbol": "${copyExampleSymbol}",
  "side": "SHORT",
  "trigger_type": "LIMIT",
  "price": "65000"
}

{
  "idempotency_key": "uuid-v4-close",
  "action": "close",
  "symbol": "${copyExampleSymbol}",
  "side": "LONG",
  "trigger_type": "MARKET"
}`}
                    </pre>
                    <p className="text-xs text-muted-foreground mt-3">
                      Close matches one open position for the same symbol and side. Follower size uses each
                      subscriber&apos;s margin and your strategy leverage.
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
                      onClick={() => void copyText(pythonSnippet, "Snippet copied")}
                    >
                      <Copy className="w-4 h-4 mr-1" /> Copy snippet
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent signals</CardTitle>
                    <CardDescription>
                      Last 50 webhook deliveries for this strategy. These are
                      live signal events, separate from the uploaded backtest
                      stats above.
                    </CardDescription>
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

                <Dialog open={editOpen} onOpenChange={setEditOpen}>
                  <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Edit copy-trading strategy</DialogTitle>
                    </DialogHeader>
                    <EditStrategyForm
                      initial={selected}
                      loading={updateMut.isPending}
                      onSubmit={(patch) =>
                        updateMut.mutate({ id: selected.id, patch })
                      }
                    />
                  </DialogContent>
                </Dialog>

                <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this listing?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes &quot;{selected.name}&quot; from your studio and cancels
                        any open webhook config. Active subscribers (if any) will be
                        unsubscribed. This cannot be undone.
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EditStrategyForm({
  initial,
  onSubmit,
  loading,
}: {
  initial: StudioStrategyRow;
  loading: boolean;
  onSubmit: (patch: Parameters<typeof updateCopyStudioStrategy>[1]) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [symbol, setSymbol] = useState(initial.symbol);
  const [side, setSide] = useState<"LONG" | "SHORT" | "BOTH">(
    (initial.side as "LONG" | "SHORT" | "BOTH") ?? "BOTH"
  );
  const [leverage, setLeverage] = useState(initial.leverage ?? "1");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">(
    initial.riskLevel
  );
  const [timeframe, setTimeframe] = useState(initial.timeframe ?? "1h");
  const descriptionChars = strategyDescriptionLength(description);
  const descriptionValid = isStrategyDescriptionValid(description);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !symbol.trim()) return;
        if (!descriptionValid) {
          toast.error(
            `Description must be at least ${MIN_STRATEGY_DESCRIPTION_CHARS} characters.`
          );
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
        });
      }}
    >
      <div>
        <Label htmlFor="edit-cs-name">Name</Label>
        <Input
          id="edit-cs-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1"
          required
        />
      </div>
      <div>
        <Label htmlFor="edit-cs-desc">Description</Label>
        <Textarea
          id="edit-cs-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 min-h-[100px]"
          required
        />
        <div className="mt-1 flex justify-between gap-2 text-xs">
          <span className={descriptionValid ? "text-profit" : "text-muted-foreground"}>
            {descriptionChars}/{MIN_STRATEGY_DESCRIPTION_CHARS} characters
          </span>
          {!descriptionValid && (
            <span className="text-warning">Explain the setup, risk, and signal rules.</span>
          )}
        </div>
      </div>
      <div>
        <Label htmlFor="edit-cs-sym">Symbol (Mudrex)</Label>
        <Input
          id="edit-cs-sym"
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
        <Label htmlFor="edit-cs-lev">Leverage</Label>
        <Input
          id="edit-cs-lev"
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
        <Label htmlFor="edit-cs-tf">Timeframe</Label>
        <Input
          id="edit-cs-tf"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          className="mt-1"
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !descriptionValid}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
      </Button>
    </form>
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
  const descriptionChars = strategyDescriptionLength(description);
  const descriptionValid = isStrategyDescriptionValid(description);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !symbol.trim()) return;
        if (!descriptionValid) {
          toast.error(
            `Description must be at least ${MIN_STRATEGY_DESCRIPTION_CHARS} characters.`
          );
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
        <div className="mt-1 flex justify-between gap-2 text-xs">
          <span className={descriptionValid ? "text-profit" : "text-muted-foreground"}>
            {descriptionChars}/{MIN_STRATEGY_DESCRIPTION_CHARS} characters
          </span>
          {!descriptionValid && (
            <span className="text-warning">Explain the setup, risk, and signal rules.</span>
          )}
        </div>
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
      <Button type="submit" className="w-full" disabled={loading || !descriptionValid}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
      </Button>
    </form>
  );
}
