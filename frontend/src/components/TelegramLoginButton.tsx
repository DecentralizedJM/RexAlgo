/**
 * Embed the official Telegram Login Widget and forward its callback payload to
 * our `/api/auth/telegram` route.
 *
 * The widget is loaded as a `<script async>` injected into a host `<div>`; we
 * expose a global callback on `window` and unmount it on cleanup so we don't
 * leak between route changes. Telegram's widget cannot be rendered twice on the
 * same page with the same callback name, so we suffix the callback with a
 * monotonic id.
 *
 * Disabled mode: when the backend's `/api/auth/telegram/config` reports
 * `enabled: false` (e.g. local dev without `TELEGRAM_BOT_USERNAME`), this
 * component renders nothing so the auth page stays clean.
 */
import { useEffect, useId, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchTelegramConfig,
  loginOrLinkWithTelegram,
  type TelegramWidgetPayload,
} from "@/lib/api";

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

export function TelegramLoginButton({
  mode = "login",
  onSuccess,
  onError,
}: {
  mode?: "login" | "link";
  onSuccess?: (linked: boolean) => void;
  onError?: (msg: string) => void;
}) {
  const cfg = useQuery({ queryKey: ["telegram-config"], queryFn: fetchTelegramConfig });
  const hostRef = useRef<HTMLDivElement>(null);
  const callbackId = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    const cb = `onTelegramAuth_${callbackId}`;
    const host = hostRef.current;
    if (!cfg.data?.enabled || !cfg.data.botUsername || !host) return;

    host.innerHTML = "";

    (window as unknown as Record<string, unknown>)[cb] = async (
      user: TelegramWidgetPayload
    ) => {
      try {
        const res = await loginOrLinkWithTelegram(user);
        onSuccess?.(res.linked);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Telegram auth failed");
      }
    };

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", cfg.data.botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-onauth", `${cb}(user)`);
    host.appendChild(script);

    return () => {
      host.innerHTML = "";
      try {
        delete (window as unknown as Record<string, unknown>)[cb];
      } catch {
        (window as unknown as Record<string, unknown>)[cb] = undefined;
      }
    };
  }, [cfg.data?.enabled, cfg.data?.botUsername, callbackId, onSuccess, onError]);

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
