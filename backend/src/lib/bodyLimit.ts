/**
 * Per-route body size guard for App Router handlers.
 *
 * Next.js `experimental.serverActions.bodySizeLimit` only applies to Server
 * Actions — nothing caps route handler bodies unless we do it ourselves. A
 * 500KB cap is comfortable for every legitimate webhook or JSON POST we
 * accept today (TV alerts, copy signals, strategy edits), but keeps an
 * attacker from posting a multi-gigabyte body that we would then buffer via
 * `req.text()` / `req.json()`.
 *
 * We rely on the `Content-Length` header because request bodies are streamed
 * through a WHATWG `ReadableStream` — reading the whole body just to measure
 * would defeat the point. Any sender can lie about `Content-Length`, but
 * Node's HTTP layer rejects mismatched lengths before the route handler runs.
 */
import { NextResponse } from "next/server";

export const DEFAULT_BODY_LIMIT_BYTES = 512 * 1024; // 512KB

export function enforceBodyLimit(
  req: { headers: { get: (name: string) => string | null } },
  limitBytes = DEFAULT_BODY_LIMIT_BYTES
): NextResponse | null {
  const raw = req.headers.get("content-length");
  if (!raw) return null; // chunked / missing → let the downstream try/catch handle oversized bodies
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n > limitBytes) {
    return NextResponse.json(
      {
        error: `Body too large (limit ${limitBytes} bytes)`,
        code: "BODY_TOO_LARGE",
      },
      { status: 413 }
    );
  }
  return null;
}
