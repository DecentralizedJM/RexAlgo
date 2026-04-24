/**
 * Bot-first Telegram login / link button.
 *
 * Why this replaces the old Login Widget:
 *   Telegram's Login Widget required a confirmation DM to already-started
 *   bots. Users who hadn't tapped `/start` got stuck on the "Please confirm
 *   access via Telegram" screen forever (see support screenshot in the
 *   change description). This component skips the widget entirely — clicking
 *   it requests a short-lived login token from our API, opens the
 *   `t.me/<bot>?start=rexalgo_<token>` deep link, and then polls
 *   `/api/auth/telegram/poll` until the bot webhook reports a claim.
 *
 * Modes:
 *   - `login`: used on `/auth`. A successful claim calls `onSignedIn(user)`
 *     so the caller can update the query cache and navigate away.
 *   - `link`:  used on `/settings` (already authenticated). A successful
 *     claim is acknowledged via `onLinked()`.
 *
 * UX rules applied (see PART 12 of the change spec):
 *   - One tap to start. We only ask for a second tap ("Open Telegram again")
 *     if the deep-link popup was blocked by the browser.
 *   - No instructions before the tap. Helper text appears only after the
 *     user is waiting for the bot to confirm.
 *   - Never strand the user. If the token expires or the tab was buried in
 *     the background, a "Try again" button restarts the flow with one tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Send } from "lucide-react";
import {
  fetchTelegramConfig,
  pollTelegramBotLogin,
  startTelegramBotLogin,
  type SessionUser,
  type TelegramPollResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 1500;

type Phase = "idle" | "starting" | "waiting" | "completing" | "expired" | "error";

type CommonProps = {
  /** Path the caller wants the browser to navigate to once the session is minted. */
  afterAuthReturnPath?: string;
  /** Label override for the idle button. */
  label?: string;
};

type LoginProps = CommonProps & {
  mode?: "login";
  onSignedIn?: (user: SessionUser, returnPath: string | null) => void;
  onLinked?: never;
};

type LinkProps = CommonProps & {
  mode: "link";
  onLinked?: (user: SessionUser) => void;
  onSignedIn?: never;
};

export type TelegramLoginButtonProps = LoginProps | LinkProps;

export function TelegramLoginButton(props: TelegramLoginButtonProps) {
  const {
    mode = "login",
    afterAuthReturnPath,
    label,
  } = props;

  const cfg = useQuery({
    queryKey: ["telegram-config"],
    queryFn: fetchTelegramConfig,
    staleTime: 5 * 60_000,
  });

  const [phase, setPhase] = useState<Phase>("idle");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  /** Remember the popup handle so a second tap refocuses instead of re-opening. */
  const popupRef = useRef<Window | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const finishWithPollResult = useCallback(
    (res: Extract<TelegramPollResponse, { status: "ok" }>) => {
      stopPolling();
      setPhase("idle");
      setDeepLink(null);
      tokenRef.current = null;
      popupRef.current = null;
      if (mode === "link") {
        props.onLinked?.(res.user);
      } else {
        props.onSignedIn?.(res.user, res.returnPath);
      }
    },
    [mode, props, stopPolling]
  );

  const runPoll = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const res = await pollTelegramBotLogin(token);
      if (res.status === "pending") {
        pollTimerRef.current = window.setTimeout(runPoll, POLL_INTERVAL_MS);
        return;
      }
      if (res.status === "expired") {
        stopPolling();
        tokenRef.current = null;
        setDeepLink(null);
        setPhase("expired");
        return;
      }
      if (res.status === "used") {
        // Another tab already consumed this token — treat as success without
        // user data (caller will refetch session).
        stopPolling();
        tokenRef.current = null;
        setDeepLink(null);
        setPhase("idle");
        return;
      }
      if (res.status === "ok") {
        setPhase("completing");
        finishWithPollResult(res);
        return;
      }
    } catch (e) {
      // Network blip — keep polling, but surface the message if it persists.
      setErrorMessage(
        e instanceof Error ? e.message : "Could not reach RexAlgo"
      );
      pollTimerRef.current = window.setTimeout(runPoll, POLL_INTERVAL_MS);
    }
  }, [finishWithPollResult, stopPolling]);

  const startMut = useMutation({
    mutationFn: () =>
      startTelegramBotLogin({ returnPath: afterAuthReturnPath ?? null }),
    onMutate: () => {
      setErrorMessage(null);
      setPhase("starting");
    },
    onSuccess: (data) => {
      tokenRef.current = data.token;
      setDeepLink(data.deepLink);
      setPhase("waiting");
      // `noopener` / `noreferrer` keep the popup from driving our tab. `_blank`
      // gets us a fresh tab on desktop; mobile browsers hand the URL straight
      // to the Telegram app which is the ideal outcome there.
      popupRef.current = window.open(data.deepLink, "_blank", "noopener,noreferrer");
      pollTimerRef.current = window.setTimeout(runPoll, POLL_INTERVAL_MS);
    },
    onError: (e) => {
      setPhase("error");
      setErrorMessage(e instanceof Error ? e.message : "Could not start Telegram login");
    },
  });

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const idleLabel = useMemo(() => {
    if (label) return label;
    return mode === "link"
      ? "Connect Telegram (1 tap)"
      : "Continue with Telegram";
  }, [label, mode]);

  if (cfg.isLoading) return null;
  if (!cfg.data?.enabled) {
    if (mode === "link") {
      return (
        <p className="text-xs text-muted-foreground">
          Telegram bot is not configured on this server — ask an admin to set{" "}
          <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_BOT_USERNAME</code>.
        </p>
      );
    }
    return null;
  }

  const isBusy = phase === "starting" || phase === "waiting" || phase === "completing";

  const reopenDeepLink = () => {
    if (!deepLink) return;
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    popupRef.current = window.open(deepLink, "_blank", "noopener,noreferrer");
  };

  const reset = () => {
    stopPolling();
    tokenRef.current = null;
    popupRef.current = null;
    setDeepLink(null);
    setErrorMessage(null);
    setPhase("idle");
  };

  return (
    <div className="flex w-full flex-col items-stretch gap-2">
      <Button
        type="button"
        variant="hero"
        size="lg"
        disabled={isBusy}
        onClick={() => startMut.mutate()}
        className="w-full justify-center gap-2"
      >
        {phase === "starting" || phase === "completing" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {phase === "waiting"
          ? "Opening Telegram…"
          : phase === "completing"
            ? "Finishing up…"
            : idleLabel}
      </Button>

      {phase === "waiting" && deepLink && (
        <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-xs text-muted-foreground">
          <p className="flex items-start gap-2">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            <span>
              Waiting for you to tap <b>START</b> in Telegram. This usually
              takes a couple of seconds.
            </span>
          </p>
          <button
            type="button"
            onClick={reopenDeepLink}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Re-open Telegram
          </button>
        </div>
      )}

      {phase === "expired" && (
        <div className="rounded-lg border border-loss/40 bg-loss/5 p-3 text-xs text-loss">
          Your login link expired. Tap the button again to get a new one.
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {phase === "error" && errorMessage && (
        <div className="rounded-lg border border-loss/40 bg-loss/5 p-3 text-xs text-loss">
          {errorMessage}
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline" onClick={reset}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
