type ClientEventType =
  | "react_error"
  | "unhandled_error"
  | "unhandled_rejection"
  | "api_error"
  | "web_vital";

type ClientEvent = {
  type: ClientEventType;
  message: string;
  route?: string;
  requestId?: string;
  data?: Record<string, unknown>;
};

function payload(event: ClientEvent): string {
  return JSON.stringify({
    ...event,
    route:
      event.route ??
      `${window.location.pathname}${window.location.search}`.slice(0, 200),
  });
}

export function reportClientEvent(event: ClientEvent): void {
  const body = payload(event);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/client-events", blob)) return;
  }
  void fetch("/api/client-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

let installed = false;

export function installGlobalTelemetry(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportClientEvent({
      type: "unhandled_error",
      message: event.message || "Unhandled browser error",
      data: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientEvent({
      type: "unhandled_rejection",
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });
}
