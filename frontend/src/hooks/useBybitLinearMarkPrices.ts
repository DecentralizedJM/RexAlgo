import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LINEAR_PUBLIC_WS = "wss://stream.bybit.com/v5/public/linear";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parsePx(v: unknown): number | undefined {
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return undefined;
}

/**
 * Live mark (or last) prices from Bybit public linear WS for the given symbols (e.g. BTCUSDT).
 * Used to refine unrealized P&amp;L when Mudrex mark is stale or uPnL is omitted.
 */
export function useBybitLinearMarkPrices(symbols: string[]): Record<string, number> {
  const [marks, setMarks] = useState<Record<string, number>>({});

  const symbolsKey = useMemo(() => {
    const s = new Set(
      symbols.map((x) => String(x || "").trim().toUpperCase()).filter(Boolean)
    );
    return [...s].sort().join(",");
  }, [symbols]);

  const pendingRef = useRef<Record<string, number>>({});
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    const batch = pendingRef.current;
    pendingRef.current = {};
    const keys = Object.keys(batch);
    if (keys.length === 0) return;
    setMarks((prev) => {
      const next = { ...prev };
      for (const k of keys) {
        next[k] = batch[k];
      }
      return next;
    });
  }, []);

  const onWsRows = useCallback(
    (rows: Record<string, unknown>[]) => {
      const pending = pendingRef.current;
      let touched = false;
      for (const row of rows) {
        const sym =
          typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
        if (!sym) continue;
        const mark = parsePx(row.markPrice) ?? parsePx(row.lastPrice);
        if (mark === undefined) continue;
        pending[sym] = mark;
        touched = true;
      }
      if (touched && rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [flush]
  );

  useEffect(() => {
    if (!symbolsKey) {
      setMarks({});
      return;
    }
    const syms = symbolsKey.split(",").filter(Boolean);
    if (syms.length === 0) {
      setMarks({});
      return;
    }

    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let reqCounter = 0;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(LINEAR_PUBLIC_WS);

        ws.onopen = () => {
          attempt = 0;
          for (const batch of chunk(syms, 10)) {
            reqCounter += 1;
            ws!.send(
              JSON.stringify({
                req_id: `rexalgo-pos-${reqCounter}`,
                op: "subscribe",
                args: batch.map((s) => `tickers.${s}`),
              })
            );
          }
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: "ping" }));
            }
          }, 15_000);
        };

        ws.onmessage = (ev) => {
          try {
            const raw = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
            if (!raw || typeof raw !== "object") return;
            const msg = raw as { topic?: string; data?: unknown; op?: string };
            if (msg.op === "pong" || msg.op === "ping" || msg.op === "subscribe") return;
            if (!msg.topic?.startsWith("tickers.")) return;
            const d = msg.data;
            const rows: Record<string, unknown>[] = [];
            if (Array.isArray(d)) {
              for (const row of d) {
                if (row && typeof row === "object") rows.push(row as Record<string, unknown>);
              }
            } else if (d && typeof d === "object") {
              rows.push(d as Record<string, unknown>);
            }
            onWsRows(rows);
          } catch {
            /* ignore */
          }
        };

        ws.onclose = () => {
          if (pingTimer) {
            clearInterval(pingTimer);
            pingTimer = null;
          }
          ws = null;
          if (closed) return;
          attempt += 1;
          const delay = Math.min(30_000, 2000 * 2 ** Math.min(attempt, 4));
          reconnectTimer = setTimeout(connect, delay);
        };

        ws.onerror = () => {
          /* onclose reconnects */
        };
      } catch {
        attempt += 1;
        reconnectTimer = setTimeout(
          connect,
          Math.min(30_000, 2000 * 2 ** Math.min(attempt, 4))
        );
      }
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = {};
      ws?.close();
      ws = null;
    };
  }, [symbolsKey, onWsRows]);

  useEffect(() => {
    const keep = new Set(symbolsKey.split(",").filter(Boolean));
    setMarks((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!keep.has(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [symbolsKey]);

  return marks;
}
