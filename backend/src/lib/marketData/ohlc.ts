/**
 * Server-only historical OHLC. Provider URL is internal (ops); never returned to clients as branding.
 */

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const DEFAULT_BASE = "https://api.bybit.com";

function ohlcBaseUrl(): string {
  const u = process.env.REXALGO_OHLC_API_BASE?.replace(/\/$/, "");
  return u && u.length > 0 ? u : DEFAULT_BASE;
}

/** Map listing timeframe labels to provider interval tokens. */
export function timeframeToInterval(tf: string | null | undefined): string {
  const t = (tf || "1h").toLowerCase().trim();
  const map: Record<string, string> = {
    "1": "1",
    "1m": "1",
    "3m": "3",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "2h": "120",
    "4h": "240",
    "6h": "360",
    "12h": "720",
    "1d": "D",
    d: "D",
    "1w": "W",
    w: "W",
  };
  return map[t] ?? "60";
}

/** Normalize to linear USDT perpetual symbol (e.g. BTC -> BTCUSDT). */
export function normalizeLinearSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace(/[-_]/g, "");
  if (s.endsWith("USDT")) return s;
  return `${s}USDT`;
}

const MAX_CANDLES = 5000;
const PAGE_LIMIT = 1000;

/**
 * Fetch closed candles ascending by open time for [startMs, endMs].
 */
export async function fetchOhlcAscending(params: {
  symbol: string;
  interval: string;
  startMs: number;
  endMs: number;
}): Promise<Candle[]> {
  const { symbol, interval, startMs, endMs } = params;
  const base = ohlcBaseUrl();
  const out: Candle[] = [];
  let cursor = startMs;

  while (cursor < endMs && out.length < MAX_CANDLES) {
    const url = new URL("/v5/market/kline", base);
    url.searchParams.set("category", "linear");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("start", String(cursor));
    url.searchParams.set("end", String(endMs));
    url.searchParams.set("limit", String(PAGE_LIMIT));

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "RexAlgo/1.0",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      throw new Error(`ohlc_http_${res.status}`);
    }

    const body = (await res.json()) as {
      retCode?: number;
      retMsg?: string;
      result?: { list?: string[][] };
    };

    if (body.retCode !== 0 || !body.result?.list?.length) {
      break;
    }

    const batch = body.result.list
      .map((row) => {
        const t = Number(row[0]);
        const o = parseFloat(row[1]);
        const h = parseFloat(row[2]);
        const l = parseFloat(row[3]);
        const c = parseFloat(row[4]);
        const v = parseFloat(row[5]);
        if (!Number.isFinite(t) || !Number.isFinite(c)) return null;
        return {
          openTime: t,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: Number.isFinite(v) ? v : 0,
        } satisfies Candle;
      })
      .filter((x): x is Candle => x != null)
      .sort((a, b) => a.openTime - b.openTime);

    if (batch.length === 0) break;

    for (const c of batch) {
      if (c.openTime >= startMs && c.openTime <= endMs) {
        if (out.length === 0 || out[out.length - 1]!.openTime !== c.openTime) {
          out.push(c);
        }
      }
    }

    const lastT = batch[batch.length - 1]!.openTime;
    const next = lastT + 1;
    if (next <= cursor) break;
    cursor = next;
    if (batch.length < PAGE_LIMIT) break;
  }

  return out.slice(0, MAX_CANDLES);
}
