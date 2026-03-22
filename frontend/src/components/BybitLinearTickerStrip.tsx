import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { LINEAR_USDT_MAJOR_BASES } from "@/lib/linearTickerMajors";

/** Public linear futures stream (USDT perps). */
const LINEAR_PUBLIC_WS = "wss://stream.bybit.com/v5/public/linear";

export type LinearTickerItem = {
  kind: "major" | "gainer";
  symbol: string;
  base: string;
  lastPrice: string;
  changeFrac: number;
};

type TickerApiResponse = {
  source?: string;
  updatedAt: number;
  majors: LinearTickerItem[];
  topGainers: LinearTickerItem[];
};

function buildClientFallback(): TickerApiResponse {
  const majors: LinearTickerItem[] = LINEAR_USDT_MAJOR_BASES.map((base) => ({
    kind: "major",
    symbol: `${base}USDT`,
    base,
    lastPrice: "—",
    changeFrac: 0,
  }));
  return {
    source: "client-fallback",
    updatedAt: 0,
    majors,
    topGainers: [],
  };
}

function fmtPrice(s: string): string {
  if (s === "—") return s;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n)) return s;
  if (n >= 1000)
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1)
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtChange(frac: number): string {
  const pct = frac * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

class SnapshotHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SnapshotHttpError";
    this.status = status;
  }
}

export default function BybitLinearTickerStrip() {
  const { data } = useQuery({
    queryKey: ["market", "linear-usdt-tickers"],
    queryFn: async (): Promise<TickerApiResponse> => {
      const res = await fetch("/api/market/linear-usdt-tickers", {
        credentials: "include",
      });
      const text = await res.text();
      if (!res.ok) {
        throw new SnapshotHttpError(
          res.status,
          `snapshot_${res.status}`
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("snapshot_bad_json");
      }
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        !("majors" in parsed) ||
        !Array.isArray((parsed as TickerApiResponse).majors)
      ) {
        throw new Error("snapshot_shape");
      }
      return parsed as TickerApiResponse;
    },
    /** Only poll when snapshot works — avoids 404 spam if /api isn’t proxied to Next or route is missing. */
    refetchInterval: (q) =>
      q.state.status === "success" ? 20_000 : false,
    staleTime: 8_000,
    retry: (failureCount, err) => {
      if (err instanceof SnapshotHttpError && err.status === 404) return false;
      if (err instanceof SnapshotHttpError && err.status >= 400 && err.status < 500)
        return false;
      return failureCount < 1;
    },
    retryDelay: (i) => Math.min(1500 * 2 ** i, 10_000),
    /** Ticker renders from client fallback + WS until REST returns; avoids flash on refetch/focus. */
    refetchOnWindowFocus: false,
  });

  const fallbackSnapshot = useMemo(() => buildClientFallback(), []);

  /** Always show something: REST snapshot when available, else majors shell until WS fills prices. */
  const displayData: TickerApiResponse = data ?? fallbackSnapshot;

  const [livePatch, setLivePatch] = useState<
    Record<string, { lastPrice?: string; changeFrac?: number }>
  >({});

  const symbolsKey = useMemo(() => {
    if (!displayData) return "";
    const s = new Set<string>();
    displayData.majors.forEach((m) => s.add(m.symbol));
    displayData.topGainers.forEach((g) => s.add(g.symbol));
    return [...s].sort().join(",");
  }, [displayData]);

  /** Batch WS ticks to one React update per frame — stops width “breathing” that jerks the -50% marquee. */
  const pendingWsRef = useRef<
    Record<string, { lastPrice?: string; changeFrac?: number }>
  >({});
  const wsRafRef = useRef<number | null>(null);

  const flushWsBatch = useCallback(() => {
    wsRafRef.current = null;
    const batch = pendingWsRef.current;
    pendingWsRef.current = {};
    if (Object.keys(batch).length === 0) return;
    setLivePatch((prev) => {
      let next = { ...prev };
      for (const [sym, upd] of Object.entries(batch)) {
        next[sym] = { ...next[sym], ...upd };
      }
      return next;
    });
  }, []);

  const applyWsData = useCallback(
    (raw: unknown) => {
      if (raw == null || typeof raw !== "object") return;
      const o = raw as Record<string, unknown>;
      const dataField = o.data;
      const rows: Record<string, unknown>[] = [];
      if (Array.isArray(dataField)) {
        for (const row of dataField) {
          if (row && typeof row === "object")
            rows.push(row as Record<string, unknown>);
        }
      } else if (dataField && typeof dataField === "object") {
        rows.push(dataField as Record<string, unknown>);
      }
      if (rows.length === 0) return;

      const pending = pendingWsRef.current;
      for (const row of rows) {
        const sym = typeof row.symbol === "string" ? row.symbol : null;
        if (!sym) continue;
        const cur = pending[sym] ?? {};
        const next = { ...cur };
        if (typeof row.lastPrice === "string") next.lastPrice = row.lastPrice;
        if (typeof row.price24hPcnt === "string") {
          const f = Number(row.price24hPcnt);
          if (Number.isFinite(f)) next.changeFrac = f;
        }
        pending[sym] = next;
      }
      if (wsRafRef.current == null) {
        wsRafRef.current = requestAnimationFrame(flushWsBatch);
      }
    },
    [flushWsBatch]
  );

  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!symbolsKey) return;

    const symbols = symbolsKey.split(",").filter(Boolean);
    if (symbols.length === 0) return;

    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let reqCounter = 0;

    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(LINEAR_PUBLIC_WS);
        wsRef.current = ws;

        ws.onopen = () => {
          attempt = 0;
          for (const batch of chunk(symbols, 10)) {
            reqCounter += 1;
            ws.send(
              JSON.stringify({
                req_id: `rexalgo-t-${reqCounter}`,
                op: "subscribe",
                args: batch.map((s) => `tickers.${s}`),
              })
            );
          }
          if (pingRef.current) clearInterval(pingRef.current);
          pingRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: "ping" }));
            }
          }, 15_000);
        };

        ws.onmessage = (ev) => {
          try {
            const raw = ev.data;
            const msg =
              typeof raw === "string"
                ? (JSON.parse(raw) as {
                    topic?: string;
                    data?: unknown;
                    op?: string;
                  })
                : null;
            if (!msg) return;
            if (msg.op === "pong" || msg.op === "ping") return;
            if (msg.op === "subscribe") return;
            if (msg.topic?.startsWith("tickers.")) {
              applyWsData({ data: msg.data });
            }
          } catch {
            /* ignore */
          }
        };

        ws.onerror = () => {
          /* onclose will reconnect */
        };

        ws.onclose = () => {
          if (pingRef.current) {
            clearInterval(pingRef.current);
            pingRef.current = null;
          }
          wsRef.current = null;
          if (closed) return;
          attempt += 1;
          const delay = Math.min(30_000, 2000 * 2 ** Math.min(attempt, 4));
          reconnectTimer = setTimeout(connect, delay);
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
      if (wsRafRef.current != null) {
        cancelAnimationFrame(wsRafRef.current);
        wsRafRef.current = null;
      }
      pendingWsRef.current = {};
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [symbolsKey, applyWsData]);

  /** Only drop patches for symbols we no longer show — don’t wipe majors when gainers load (that caused a visible jerk). */
  useEffect(() => {
    const keep = new Set(symbolsKey.split(",").filter(Boolean));
    setLivePatch((prev) => {
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

  const rows = useMemo(() => {
    const patch = livePatch;
    const apply = (item: LinearTickerItem) => {
      const p = patch[item.symbol];
      return {
        ...item,
        lastPrice: p?.lastPrice ?? item.lastPrice,
        changeFrac:
          p?.changeFrac !== undefined ? p.changeFrac : item.changeFrac,
      };
    };
    return {
      majors: displayData.majors.map(apply),
      gainers: displayData.topGainers.map(apply),
    };
  }, [displayData, livePatch]);

  if (rows.majors.length === 0 && rows.gainers.length === 0) {
    return null;
  }

  const Pill = ({ item }: { item: LinearTickerItem }) => {
    const noQuote = item.lastPrice === "—";
    const up = item.changeFrac >= 0;
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs sm:text-sm shadow-sm">
        <span className="min-w-[2.25rem] font-semibold text-foreground">
          {item.base}
        </span>
        {/* Fixed-ish width so digit updates don’t resize the marquee track */}
        <span className="inline-block min-w-[6.5rem] text-right font-mono text-muted-foreground tabular-nums">
          {fmtPrice(item.lastPrice)}
        </span>
        <span
          className={
            noQuote
              ? "inline-block min-w-[3.5rem] text-right font-mono tabular-nums text-muted-foreground"
              : up
                ? "inline-block min-w-[3.5rem] text-right text-profit font-mono tabular-nums"
                : "inline-block min-w-[3.5rem] text-right text-loss font-mono tabular-nums"
          }
        >
          {noQuote ? "—" : fmtChange(item.changeFrac)}
        </span>
      </span>
    );
  };

  const Segment = ({ id }: { id: string }) => (
    <>
      {rows.majors.map((item) => (
        <Pill key={`${id}-m-${item.symbol}`} item={item} />
      ))}
      {rows.gainers.length > 0 ? (
        <>
          <span className="inline-flex items-center gap-1 pl-4 pr-2 text-[10px] font-bold uppercase tracking-widest text-primary sm:text-xs">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            24h gainers
          </span>
          {rows.gainers.map((item) => (
            <Pill key={`${id}-g-${item.symbol}`} item={item} />
          ))}
        </>
      ) : null}
    </>
  );

  return (
    <div
      className="group relative overflow-hidden py-2.5"
      aria-label="Live market prices; scrolls horizontally. Pause by hovering."
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background to-transparent sm:w-20" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent sm:w-20" />
      <div className="overflow-hidden">
        <div className="landing-ticker-track flex w-max items-stretch">
          <div className="flex shrink-0 items-center gap-3 pr-10 sm:gap-4 sm:pr-14">
            <Segment id="a" />
          </div>
          <div className="flex shrink-0 items-center gap-3 pr-10 sm:gap-4 sm:pr-14">
            <Segment id="b" />
          </div>
        </div>
      </div>
    </div>
  );
}
