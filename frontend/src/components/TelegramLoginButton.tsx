/**
 * Embed the official Telegram Login Widget and complete auth via **redirect**
 * (`data-auth-url`), not the JS callback. Telegram's phone-confirm step often
 * fails to invoke `data-onauth` from the iframe across browsers; redirect is
 * the supported alternative (same behaviour as choosing "Redirect to URL" in
 * BotFather widget builder).
 *
 * The widget is loaded as a `<script async>` injected into a host `<div>`.
 *
 * Disabled mode: when the backend's `/api/auth/telegram/config` reports
 * `enabled: false` (e.g. local dev without `TELEGRAM_BOT_USERNAME`), this
 * component renders nothing so the auth page stays clean.
 *
 * **Browser debug:** open `/auth?telegram_debug=1` or run
 * `localStorage.setItem("rexalgoDebugTelegram","1")` then reload — the console
 * logs the exact `data-auth-url` Telegram will redirect to after login.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTelegramConfig } from "@/lib/api";

function telegramClientDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage?.getItem("rexalgoDebugTelegram") === "1") return true;
    return new URLSearchParams(window.location.search).has("telegram_debug");
  } catch {
    return false;
  }
}

export function TelegramLoginButton({
  mode = "login",
  /** Path only (e.g. `/dashboard`). Telegram redirects back here after login. */
  afterAuthReturnPath,
}: {
  mode?: "login" | "link";
  afterAuthReturnPath?: string;
}) {
  const cfg = useQuery({
    queryKey: ["telegram-config"],
    queryFn: fetchTelegramConfig,
    staleTime: 5 * 60_000,
  });
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!cfg.data?.enabled || !cfg.data.botUsername || !host) return;

    const returnPath =
      afterAuthReturnPath ?? (mode === "link" ? "/settings" : "/dashboard");
    const authUrl = `${window.location.origin}/api/auth/telegram?return=${encodeURIComponent(returnPath)}`;

    if (telegramClientDebugEnabled()) {
      console.info("[rexalgo:telegram:client] widget_mount", {
        dataAuthUrl: authUrl,
        returnPath,
        botUsername: cfg.data.botUsername,
        hint: "After you confirm in Telegram, you should see a GET to /api/auth/telegram in Network. If not, Telegram never left the widget (domain / widget mode).",
      });
    }

    host.innerHTML = "";

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", cfg.data.botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-auth-url", authUrl);
    host.appendChild(script);

    return () => {
      host.innerHTML = "";
    };
  }, [cfg.data?.enabled, cfg.data?.botUsername, mode, afterAuthReturnPath]);

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
  return <div ref={hostRef} data-telegram-widget-host />;
}
