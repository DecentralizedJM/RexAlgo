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

function mergeWsRow(
  prev: Record<string, { lastPrice?: string; changeFrac?: number }>,
  row: Record<string, unknown>
): Record<string, { lastPrice?: string; changeFrac?: number }> {
  const sym = typeof row.symbol === "string" ? row.symbol : null;
  if (!sym) return prev;
  const cur = prev[sym] ?? {};
  const next = { ...cur };
  if (typeof row.lastPrice === "string") next.lastPrice = row.lastPrice;
  if (typeof row.price24hPcnt === "string") {
    const f = Number(row.price24hPcnt);
    if (Number.isFinite(f)) next.changeFrac = f;
  }
  return { ...prev, [sym]: next };
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
        throw new Error(`snapshot_${res.status}`);
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
    refetchInterval: 20_000,
    staleTime: 8_000,
    retry: 2,
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

  const applyWsData = useCallback((raw: unknown) => {
    if (raw == null || typeof raw !== "object") return;
    const o = raw as Record<string, unknown>;
    const dataField = o.data;
    setLivePatch((prev) => {
      if (Array.isArray(dataField)) {
        let next = prev;
        for (const row of dataField) {
          if (row && typeof row === "object")
            next = mergeWsRow(next, row as Record<string, unknown>);
        }
        return next;
      }
      if (dataField && typeof dataField === "object") {
        return mergeWsRow(prev, dataField as Record<string, unknown>);
      }
      return prev;
    });
  }, []);

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
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [symbolsKey, applyWsData]);

  useEffect(() => {
    setLivePatch({});
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
        <span className="font-semibold text-foreground">{item.base}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {fmtPrice(item.lastPrice)}
        </span>
        <span
          className={
            noQuote
              ? "font-mono tabular-nums text-muted-foreground"
              : up
                ? "text-profit font-mono tabular-nums"
                : "text-loss font-mono tabular-nums"
          }
        >
          {noQuote ? "—" : fmtChange(item.changeFrac)}
        </span>
      </span>
    );
  };

  const Segment = ({ id }: { id: string }) => (
    <>
      <span className="inline-flex items-center gap-2 pr-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:text-xs">
        USDT perpetuals
      </span>
      <span className="inline-flex items-center pr-1 text-[10px] font-bold uppercase tracking-wider text-primary/90 sm:text-xs">
        Top market cap
      </span>
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
      aria-label="Live USDT perpetual futures prices; scrolls horizontally. Pause by hovering."
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
