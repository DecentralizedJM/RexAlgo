/**
 * Bot-first Telegram link button (deep-link + poll). Styled like Telegram’s
 * official login affordance: brand blue + paper-plane mark.
 *
 * Modes:
 *   - `login`: rare; kept for API parity. Success → `onSignedIn`.
 *   - `link`:  signed-in user connects alerts. Success → `onLinked`.
 *
 * `layout="card"` — full-width, tall (settings card).
 * `layout="inline"` — compact (dashboard header).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  fetchTelegramConfig,
  fetchTelegramLinkIntent,
  pollTelegramBotLogin,
  startTelegramBotLogin,
  type SessionUser,
  type TelegramPollResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 1500;

/** Telegram brand blue (official widget tone). */
const TG_BTN =
  "border-0 bg-[#229ED9] text-white shadow-sm hover:bg-[#1f8bc7] hover:text-white active:bg-[#1a7aaf] disabled:opacity-60 disabled:hover:bg-[#229ED9]";

function TelegramPlaneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M9.78 18.65l.75-3.54 8.05-7.38c.36-.33-.08-.5-.52-.2L7.74 16.3 3.64 14.7c-.88-.39-.86-.85.19-1.29l14.68-5.66c.88-.41 1.65-.2 1.38 1.19l-2.48 11.69c-.27 1.26-.92 1.56-1.87.97l-5.22-3.86-2.52 2.43c-.3.29-.54.53-1.08.54z" />
    </svg>
  );
}

type Phase = "idle" | "starting" | "waiting" | "completing" | "expired" | "error";

type CommonProps = {
  afterAuthReturnPath?: string;
  label?: string;
  /** `card` = full-width settings; `inline` = compact dashboard header. */
  layout?: "card" | "inline";
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
    layout = "card",
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
      setErrorMessage(
        e instanceof Error ? e.message : "Could not reach RexAlgo"
      );
      pollTimerRef.current = window.setTimeout(runPoll, POLL_INTERVAL_MS);
    }
  }, [finishWithPollResult, stopPolling]);

  const startMut = useMutation({
    mutationFn: async () => {
      let linkToken: string | null = null;
      if (mode === "link") {
        const intent = await fetchTelegramLinkIntent();
        linkToken = intent.linkToken;
      }
      return startTelegramBotLogin({
        returnPath: afterAuthReturnPath ?? null,
        linkToken,
      });
    },
    onMutate: () => {
      setErrorMessage(null);
      setPhase("starting");
    },
    onSuccess: (data) => {
      tokenRef.current = data.token;
      setDeepLink(data.deepLink);
      setPhase("waiting");
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

  const idleLabel = useMemo(() => label ?? "Connect Telegram", [label]);

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

  const isInline = layout === "inline";

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        isInline ? "w-auto max-w-none items-stretch" : "w-full max-w-[min(100%,20rem)] items-stretch"
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size={isInline ? "sm" : "lg"}
        disabled={isBusy}
        onClick={() => startMut.mutate()}
        className={cn(
          TG_BTN,
          "gap-2 font-semibold rounded-[10px]",
          isInline ? "h-9 px-3 justify-center shrink-0" : "h-12 w-full justify-center px-8 text-base"
        )}
      >
        {phase === "starting" || phase === "completing" ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <TelegramPlaneIcon className="h-5 w-5 shrink-0 opacity-95" />
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
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#229ED9]" />
            <span>
              Waiting for you to tap <b>START</b> in Telegram. This usually
              takes a couple of seconds.
            </span>
          </p>
          <button
            type="button"
            onClick={reopenDeepLink}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#229ED9] hover:underline"
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
