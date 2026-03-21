import { NextResponse } from "next/server";

/** USDT-margined linear perps only; base coin before "USDT". */
const STABLE_BASES = new Set([
  "USDT",
  "USDC",
  "DAI",
  "TUSD",
  "FDUSD",
  "BUSD",
  "USDD",
  "USDE",
  "PYUSD",
  "GUSD",
  "EUR",
  "BRZ",
]);

/** Rough market-cap leaders (non-stable) that list as {BASE}USDT on linear USDT perps. */
const MAJOR_BASES_ORDER = [
  "BTC",
  "ETH",
  "XRP",
  "SOL",
  "BNB",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "DOT",
] as const;

const LINEAR_TICKERS_URL =
  "https://api.bybit.com/v5/market/tickers?category=linear";

type ExchangeTicker = {
  symbol: string;
  lastPrice?: string;
  price24hPcnt?: string;
  turnover24h?: string;
};

function baseFromUsdtLinear(symbol: string): string | null {
  if (!symbol.endsWith("USDT")) return null;
  return symbol.slice(0, -4);
}

function parseNum(s: string | undefined, fallback = 0): number {
  if (s == null || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET() {
  try {
    const res = await fetch(LINEAR_TICKERS_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "RexAlgo/1.0 (+https://github.com/DecentralizedJM/RexAlgo)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "provider_http", status: res.status },
        { status: 502 }
      );
    }

    const body = (await res.json()) as {
      retCode?: number;
      retMsg?: string;
      result?: { list?: ExchangeTicker[] };
    };

    if (body.retCode !== 0 || !body.result?.list) {
      return NextResponse.json(
        { error: "provider_bad_response", retMsg: body.retMsg },
        { status: 502 }
      );
    }

    const list = body.result.list;
    const bySymbol = new Map<string, ExchangeTicker>();
    for (const t of list) {
      if (t.symbol) bySymbol.set(t.symbol, t);
    }

    const majors = MAJOR_BASES_ORDER.map((base) => {
      const symbol = `${base}USDT`;
      const t = bySymbol.get(symbol);
      return {
        kind: "major" as const,
        symbol,
        base,
        lastPrice: t?.lastPrice ?? "—",
        changeFrac: parseNum(t?.price24hPcnt),
      };
    });

    const majorSymbols = new Set(majors.map((m) => m.symbol));

    const gainersPool = list
      .filter((t) => {
        const b = baseFromUsdtLinear(t.symbol);
        if (!b || STABLE_BASES.has(b)) return false;
        if (parseNum(t.turnover24h) < 2_000_000) return false;
        return true;
      })
      .map((t) => ({
        kind: "gainer" as const,
        symbol: t.symbol,
        base: baseFromUsdtLinear(t.symbol)!,
        lastPrice: t.lastPrice ?? "—",
        changeFrac: parseNum(t.price24hPcnt),
      }))
      .sort((a, b) => b.changeFrac - a.changeFrac)
      .filter((g) => !majorSymbols.has(g.symbol))
      .slice(0, 8);

    return NextResponse.json(
      {
        source: "linear-usdt",
        updatedAt: Date.now(),
        majors,
        topGainers: gainersPool,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
        },
      }
    );
  } catch (e) {
    console.error("[linear-usdt-tickers]", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
