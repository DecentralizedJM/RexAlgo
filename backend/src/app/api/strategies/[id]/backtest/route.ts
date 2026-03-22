import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import {
  defaultBacktestSpec,
  parseBacktestSpecJson,
} from "@/lib/backtest/spec";
import { runStrategyBacktest } from "@/lib/backtest/runBacktest";
import {
  fetchOhlcAscending,
  normalizeLinearSymbol,
  timeframeToInterval,
} from "@/lib/marketData/ohlc";

function clampMonths(m: unknown): number {
  const n = typeof m === "number" ? m : parseFloat(String(m ?? 6));
  if (!Number.isFinite(n)) return 6;
  return Math.min(36, Math.max(1, Math.floor(n)));
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: strategyId } = await ctx.params;

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  if (strategy.type !== "algo") {
    return NextResponse.json(
      { error: "Backtest is only available for algo strategies" },
      { status: 403 }
    );
  }

  const isCreator = strategy.creatorId === userId;
  if (!strategy.isActive && !isCreator) {
    return NextResponse.json(
      { error: "Strategy is not available for backtest" },
      { status: 403 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const lookbackMonths = clampMonths(body.lookbackMonths);
  const initialCapital = Math.max(
    100,
    Math.min(1e9, Number(body.initialCapital) || 10_000)
  );
  const riskPctPerTrade = Math.min(
    0.1,
    Math.max(0.005, Number(body.riskPctPerTrade) || 0.02)
  );
  const feeRoundTrip = Math.min(
    0.05,
    Math.max(0, Number(body.feeRoundTrip) || 0.001)
  );

  const spec =
    parseBacktestSpecJson(strategy.backtestSpecJson) ?? defaultBacktestSpec();

  const endMs = Date.now();
  const startMs = endMs - lookbackMonths * 30 * 24 * 60 * 60 * 1000;

  const symbol = normalizeLinearSymbol(strategy.symbol);
  const interval = timeframeToInterval(strategy.timeframe);

  let candles;
  try {
    candles = await fetchOhlcAscending({
      symbol,
      interval,
      startMs,
      endMs,
    });
  } catch (e) {
    console.error("backtest ohlc fetch:", e);
    return NextResponse.json(
      { error: "Could not load historical data. Try again later." },
      { status: 502 }
    );
  }

  const result = runStrategyBacktest(candles, strategy, spec, {
    initialCapital,
    riskPctPerTrade,
    feeRoundTrip,
    defaultStopPct: 0.02,
  });

  return NextResponse.json({
    result,
    meta: {
      barsUsed: candles.length,
      rangeStart: startMs,
      rangeEnd: endMs,
    },
  });
}
