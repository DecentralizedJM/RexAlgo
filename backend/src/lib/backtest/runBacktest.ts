import type { Candle } from "@/lib/marketData/ohlc";
import type { BacktestSpec } from "@/lib/backtest/spec";
import type { strategies } from "@/lib/schema";

type StrategyRow = typeof strategies.$inferSelect;

export type BacktestRunOptions = {
  initialCapital: number;
  riskPctPerTrade: number;
  /** Round-trip fee as decimal, e.g. 0.001 = 0.1% */
  feeRoundTrip: number;
  /** Default stop distance as price fraction if strategy has no stoplossPct */
  defaultStopPct: number;
};

export type BacktestTrade = {
  side: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  reason: "signal" | "stop" | "take_profit";
  pnlUsdt: number;
};

export type BacktestResult = {
  summary: {
    initialCapital: number;
    finalEquity: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    winRatePct: number;
    tradeCount: number;
    feesApproxUsdt: number;
  };
  equity: { t: number; equity: number }[];
  trades: BacktestTrade[];
};

function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]!;
    if (i >= period) sum -= closes[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function runStrategyBacktest(
  candles: Candle[],
  strategy: StrategyRow,
  spec: BacktestSpec,
  opts: BacktestRunOptions
): BacktestResult {
  const initialCapital = Math.max(100, opts.initialCapital);
  const riskPct = Math.min(0.1, Math.max(0.005, opts.riskPctPerTrade));
  const feeRt = Math.max(0, opts.feeRoundTrip);
  const defaultStop = Math.min(0.2, Math.max(0.005, opts.defaultStopPct));

  const closes = candles.map((c) => c.close);
  if (closes.length < 50) {
    return emptyResult(initialCapital);
  }

  if (spec.engine !== "sma_cross") {
    return emptyResult(initialCapital);
  }

  const fastP = spec.params.fastPeriod as number;
  const slowP = spec.params.slowPeriod as number;
  const fast = sma(closes, fastP);
  const slow = sma(closes, slowP);

  const slFrac = (strategy.stoplossPct ?? defaultStop * 100) / 100;
  const tpFrac = strategy.takeprofitPct != null ? strategy.takeprofitPct / 100 : null;

  let equity = initialCapital;
  let peak = equity;
  let maxDd = 0;
  let feesTotal = 0;

  type Pos =
    | { kind: "flat" }
    | {
        kind: "long" | "short";
        entry: number;
        entryTime: number;
        qty: number;
        stop: number;
        takeProfit: number | null;
      };

  const posHolder: { p: Pos } = { p: { kind: "flat" } };
  const trades: BacktestTrade[] = [];
  const equityPts: { t: number; equity: number }[] = [];

  const sideAllowLong =
    strategy.side === "LONG" || strategy.side === "BOTH";
  const sideAllowShort =
    strategy.side === "SHORT" || strategy.side === "BOTH";

  function closePosition(
    exitPrice: number,
    exitTime: number,
    reason: BacktestTrade["reason"]
  ) {
    if (posHolder.p.kind === "flat") return;
    const { entry, entryTime, qty, kind } = posHolder.p;
    const raw =
      kind === "long" ? (exitPrice - entry) * qty : (entry - exitPrice) * qty;
    const fee = Math.abs(qty * entry) * feeRt * 0.5 + Math.abs(qty * exitPrice) * feeRt * 0.5;
    feesTotal += fee;
    const pnl = raw - fee;
    equity += pnl;
    trades.push({
      side: kind === "long" ? "LONG" : "SHORT",
      entryTime,
      exitTime,
      entryPrice: entry,
      exitPrice,
      reason,
      pnlUsdt: pnl,
    });
    posHolder.p = { kind: "flat" };
  }

  function openLong(price: number, t: number) {
    const stop = price * (1 - slFrac);
    const stopDist = price - stop;
    if (stopDist <= 0) return;
    const riskUsd = equity * riskPct;
    const qty = riskUsd / stopDist;
    posHolder.p = {
      kind: "long",
      entry: price,
      entryTime: t,
      qty,
      stop,
      takeProfit: tpFrac != null ? price * (1 + tpFrac) : null,
    };
  }

  function openShort(price: number, t: number) {
    const stop = price * (1 + slFrac);
    const stopDist = stop - price;
    if (stopDist <= 0) return;
    const riskUsd = equity * riskPct;
    const qty = riskUsd / stopDist;
    posHolder.p = {
      kind: "short",
      entry: price,
      entryTime: t,
      qty,
      stop,
      takeProfit: tpFrac != null ? price * (1 - tpFrac) : null,
    };
  }

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i]!;
    const prevF = fast[i - 1];
    const prevS = slow[i - 1];
    const curF = fast[i];
    const curS = slow[i];
    const price = bar.close;
    const t = bar.openTime;

    if (posHolder.p.kind === "long") {
      if (bar.low <= posHolder.p.stop) {
        closePosition(posHolder.p.stop, t, "stop");
      } else if (posHolder.p.takeProfit != null && bar.high >= posHolder.p.takeProfit) {
        closePosition(posHolder.p.takeProfit, t, "take_profit");
      }
    } else if (posHolder.p.kind === "short") {
      if (bar.high >= posHolder.p.stop) {
        closePosition(posHolder.p.stop, t, "stop");
      } else if (posHolder.p.takeProfit != null && bar.low <= posHolder.p.takeProfit) {
        closePosition(posHolder.p.takeProfit, t, "take_profit");
      }
    }

    const golden =
      prevF != null &&
      prevS != null &&
      curF != null &&
      curS != null &&
      Number.isFinite(prevF) &&
      Number.isFinite(prevS) &&
      Number.isFinite(curF) &&
      Number.isFinite(curS);

    if (golden) {
      const bullCross = prevF <= prevS && curF > curS;
      const bearCross = prevF >= prevS && curF < curS;

      if (posHolder.p.kind === "long" && bearCross) {
        closePosition(price, t, "signal");
      } else if (posHolder.p.kind === "short" && bullCross) {
        closePosition(price, t, "signal");
      }

      if (posHolder.p.kind === "flat") {
        if (bullCross && sideAllowLong) {
          openLong(price, t);
        } else if (bearCross && sideAllowShort) {
          openShort(price, t);
        }
      }
    }

    let mark = equity;
    if (posHolder.p.kind === "long") {
      mark += (price - posHolder.p.entry) * posHolder.p.qty;
    } else if (posHolder.p.kind === "short") {
      mark += (posHolder.p.entry - price) * posHolder.p.qty;
    }
    if (mark > peak) peak = mark;
    const dd = peak > 0 ? ((peak - mark) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
    equityPts.push({ t, equity: mark });
  }

  if (posHolder.p.kind !== "flat") {
    const last = candles[candles.length - 1]!;
    closePosition(last.close, last.openTime, "signal");
  }

  const wins = trades.filter((x) => x.pnlUsdt > 0).length;
  const tradeCount = trades.length;
  const winRatePct = tradeCount ? (wins / tradeCount) * 100 : 0;
  const totalReturnPct =
    initialCapital > 0 ? ((equity - initialCapital) / initialCapital) * 100 : 0;

  return {
    summary: {
      initialCapital,
      finalEquity: equity,
      totalReturnPct,
      maxDrawdownPct: maxDd,
      winRatePct,
      tradeCount,
      feesApproxUsdt: feesTotal,
    },
    equity: equityPts,
    trades: trades.slice(-200),
  };
}

function emptyResult(initialCapital: number): BacktestResult {
  return {
    summary: {
      initialCapital,
      finalEquity: initialCapital,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      winRatePct: 0,
      tradeCount: 0,
      feesApproxUsdt: 0,
    },
    equity: [],
    trades: [],
  };
}
