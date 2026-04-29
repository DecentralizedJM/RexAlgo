/**
 * StudioSubmitChecklist
 *
 * Inline guidance + submission button for the Strategy / Copy-trading studios.
 * Replaces the small "Setup: verify your webhook" callout and the lone
 * "Submit for admin review" button with an explicit three-step flow:
 *
 *   1. Generate webhook URL  (done when `webhookEnabled === true`)
 *   2. Send a test signal    (done when `webhookLastDeliveryAt` is set)
 *   3. Submit for admin review (enabled iff steps 1 + 2 are done)
 *
 * Step 2 is interactive: after the creator pastes the URL into TradingView /
 * their bot, they click "I'm sending the test signal now" which fires
 * `onSignalListenStart` so the parent can poll the studio strategies query
 * faster (see `liveDataQueryOptions`). When `webhookLastDeliveryAt` flips
 * from null to a timestamp, step 2 transitions to a green "Signal received"
 * state automatically. Refetch cadence and the listening timer live in the
 * parent — this component is presentational + a couple of callbacks.
 *
 * For `rejected` strategies we surface `rejectionReason` at the top with a
 * "Reapply" CTA. Once reapplied the row goes back to draft and the same
 * checklist guides the next attempt.
 *
 * Server-side gate (kept identical) lives in
 * `backend/src/app/api/marketplace/studio/strategies/[id]/submit-review/route.ts`
 * (and its copy-trading twin): `status === "draft"` AND
 * `copy_webhook_config.enabled` AND `copy_webhook_config.last_delivery_at IS
 * NOT NULL`.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowDownCircle,
  Check,
  FileCheck2,
  Loader2,
  Radio,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { StrategyReviewStatus } from "@/lib/api";

type StepKey = "webhook" | "backtest" | "signal" | "submit";
type StepState = "pending" | "active" | "done" | "blocked";

const STEP_TITLES: Record<StepKey, string> = {
  webhook: "1. Create the signal endpoint",
  backtest: "2. Publish your backtest",
  signal: "3. Send a test signal",
  submit: "4. Submit for admin review",
};

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

function StepIndicator({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-profit text-profit-foreground"
        aria-hidden
      >
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-warning bg-warning/20 text-warning"
        aria-hidden
      >
        <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
      </span>
    );
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-secondary/40 text-xs text-muted-foreground"
      aria-hidden
    />
  );
}

export interface StudioSubmitChecklistProps {
  status: StrategyReviewStatus;
  /**
   * `true` once the creator has run "Create webhook URL" at least once.
   * Stays `true` even when the endpoint is currently disabled. Used to
   * differentiate the "endpoint exists but is paused" copy from the empty
   * pre-creation state — see the matching server flag in the studio list
   * routes (`webhookConfigured`).
   */
  webhookConfigured: boolean;
  webhookEnabled: boolean;
  webhookLastDeliveryAt: string | null;
  hasBacktest: boolean;
  rejectionReason: string | null;
  /** Submit-review mutation pending state. */
  submitting: boolean;
  /** Fires the existing submit-review mutation on the parent. */
  onSubmit: () => void;
  /** Resubmit (reapply) for rejected listings. */
  onReapply?: () => void;
  /** Resubmit mutation pending state. */
  reapplying?: boolean;
  /**
   * Called when the user clicks "I'm sending the test signal now" so the
   * parent can switch the studio strategies query into a fast-poll mode
   * (see `liveDataQueryOptions` + the parent's `useQuery` overrides).
   */
  onSignalListenStart?: () => void;
  onGoToWebhook?: () => void;
  onGoToBacktest?: () => void;
  onGoToSignalTest?: () => void;
}

export default function StudioSubmitChecklist({
  status,
  webhookConfigured,
  webhookEnabled,
  webhookLastDeliveryAt,
  hasBacktest,
  rejectionReason,
  submitting,
  onSubmit,
  onReapply,
  reapplying = false,
  onSignalListenStart,
  onGoToWebhook,
  onGoToBacktest,
  onGoToSignalTest,
}: StudioSubmitChecklistProps) {
  const [listening, setListening] = useState(false);
  const [recentlyArrived, setRecentlyArrived] = useState(false);
  const lastSeenDeliveryRef = useRef<string | null>(webhookLastDeliveryAt);

  // Detect the moment `webhookLastDeliveryAt` flips from null/older → newer.
  // We flash the green "Signal received" pill for 5s, then settle into the
  // permanent "done" state. Tracking the previous value via ref avoids
  // re-flashing on every parent refetch.
  useEffect(() => {
    const prev = lastSeenDeliveryRef.current;
    if (
      webhookLastDeliveryAt &&
      (!prev || webhookLastDeliveryAt !== prev)
    ) {
      lastSeenDeliveryRef.current = webhookLastDeliveryAt;
      if (prev !== webhookLastDeliveryAt && prev !== null) {
        setRecentlyArrived(true);
      } else if (prev === null) {
        setRecentlyArrived(true);
      }
      setListening(false);
      const t = window.setTimeout(() => setRecentlyArrived(false), 5_000);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [webhookLastDeliveryAt]);

  // Stop listening if the parent disabled the webhook from outside the
  // checklist (e.g. via the "Disable" button) so we don't keep showing
  // "Listening..." forever.
  useEffect(() => {
    if (!webhookEnabled) setListening(false);
  }, [webhookEnabled]);

  const isRejected = status === "rejected";
  const stepStates: Record<StepKey, StepState> = {
    webhook: webhookEnabled ? "done" : "active",
    backtest: hasBacktest ? "done" : webhookEnabled ? "active" : "pending",
    signal: !webhookEnabled
      ? "pending"
      : webhookLastDeliveryAt
        ? "done"
        : listening
          ? "active"
          : "active",
    submit:
      webhookEnabled && hasBacktest && webhookLastDeliveryAt
        ? "active"
        : "pending",
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm">
      {isRejected && (
        <div className="mb-4 rounded-md border border-loss/40 bg-loss/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="h-4 w-4 mt-0.5 shrink-0 text-loss"
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-loss leading-snug">
                Listing was rejected
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {rejectionReason?.trim()
                  ? rejectionReason
                  : "An admin returned this listing without a written reason. Edit the details, reapply, and we'll requeue it for review."}
              </p>
            </div>
          </div>
          {onReapply && (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={reapplying}
                onClick={onReapply}
              >
                {reapplying ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-1" />
                )}
                Reapply
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex items-baseline justify-between gap-2 flex-wrap">
        <p className="font-semibold text-foreground">
          {isRejected
            ? "After you reapply, finish these steps:"
            : "Four steps to go live"}
        </p>
        {!isRejected && (
          <p className="text-xs text-muted-foreground">
            Subscriber mirroring stays off until an admin approves.
          </p>
        )}
      </div>

      <ol className="space-y-3">
        {/* Step 1 — generate URL */}
        <li className="flex items-start gap-3">
          <StepIndicator state={stepStates.webhook} />
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "font-medium",
                stepStates.webhook === "done"
                  ? "text-foreground"
                  : "text-foreground"
              )}
            >
              {STEP_TITLES.webhook}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {webhookEnabled
                ? "Signal endpoint created. Use the masked URL below when configuring TradingView or your bot — RexAlgo listens here for your strategy signals."
                : webhookConfigured
                  ? "Endpoint exists but is currently disabled. Click Regenerate URL below to mint a fresh secret URL and re-enable mirroring."
                  : "Create a private RexAlgo signal endpoint. This is the URL where TradingView or your bot will POST strategy signals; RexAlgo will mirror them to subscribers after admin approval."
              }
            </p>
            {onGoToWebhook && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-2 h-7 px-2 text-xs"
                onClick={onGoToWebhook}
              >
                <ArrowDownCircle className="h-3.5 w-3.5 mr-1" />
                Go to Signal endpoint
              </Button>
            )}
          </div>
        </li>

        {/* Step 2 — publish backtest */}
        <li className="flex items-start gap-3">
          <StepIndicator state={stepStates.backtest} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">{STEP_TITLES.backtest}</p>
            {hasBacktest ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-profit/15 px-2 py-0.5 text-xs font-medium text-profit">
                  <FileCheck2 className="h-3 w-3" />
                  Backtest published
                </span>
                <span className="text-xs text-muted-foreground">
                  Admins will review this evidence before approval.
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Upload a real JSON backtest or TradingView Strategy Tester export.
                Sample payloads and weak data cannot be submitted.
              </p>
            )}
            {onGoToBacktest && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-2 h-7 px-2 text-xs"
                onClick={onGoToBacktest}
              >
                <ArrowDownCircle className="h-3.5 w-3.5 mr-1" />
                Go to Publish backtest
              </Button>
            )}
          </div>
        </li>

        {/* Step 3 — send test signal */}
        <li className="flex items-start gap-3">
          <StepIndicator state={stepStates.signal} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">{STEP_TITLES.signal}</p>
            {!webhookEnabled ? (
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Available after step 1. Paste the webhook URL into TradingView
                or your bot, then send a test signal here.
              </p>
            ) : webhookLastDeliveryAt ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                    recentlyArrived
                      ? "bg-profit/20 text-profit animate-pulse"
                      : "bg-profit/15 text-profit"
                  )}
                >
                  <Check className="h-3 w-3" />
                  Signal received {formatRelative(webhookLastDeliveryAt)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Send another at any time to retest.
                </span>
              </div>
            ) : listening ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                  <Radio className="h-3 w-3 animate-pulse" />
                  Listening for your test signal…
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setListening(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setListening(true);
                    onGoToSignalTest?.();
                    onSignalListenStart?.();
                  }}
                >
                  <Radio className="h-3.5 w-3.5 mr-1" />
                  I&rsquo;m sending the test signal now
                </Button>
                <span className="text-xs text-muted-foreground">
                  We&rsquo;ll watch for the first delivery and turn this green.
                </span>
              </div>
            )}
            {onGoToSignalTest && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-2 h-7 px-2 text-xs"
                onClick={onGoToSignalTest}
              >
                <ArrowDownCircle className="h-3.5 w-3.5 mr-1" />
                Go to Signal test
              </Button>
            )}
          </div>
        </li>

        {/* Step 4 — submit */}
        <li className="flex items-start gap-3">
          <StepIndicator state={stepStates.submit} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground">{STEP_TITLES.submit}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {stepStates.submit === "active"
                ? "Everything looks good. An admin will review your listing — you\u2019ll see status updates here."
                : "Available after the endpoint, published backtest, and verified test signal are complete."
              }
            </p>
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                disabled={
                  submitting ||
                  isRejected ||
                  !webhookEnabled ||
                  !hasBacktest ||
                  !webhookLastDeliveryAt
                }
                onClick={onSubmit}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-1" />
                )}
                Submit for admin review
              </Button>
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}
