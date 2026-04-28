/**
 * Validation + types for creator-uploaded backtest payloads.
 *
 * Replaces the simulated `sma_cross` / `rule_builder_v1` engines with a
 * single normalised shape that the studio + public detail panels can render
 * without branching. Two upload kinds produce the same shape:
 *
 *   - `"json"`      → user-supplied JSON (this module is the gate)
 *   - `"tv_export"` → TradingView "List of Trades" CSV / Performance Summary
 *                    JSON parsed by `parseTvExport.ts`
 *
 * We deliberately use hand-rolled validation (mirroring
 * `validateStrategyPatch`, `validateSubscriptionMargin`, etc.) instead of
 * pulling in zod — zod is not currently a dependency here and the surface
 * is small.
 */

export type UploadedBacktestSummary = {
  totalReturnPct: number;
  winRatePct: number;
  maxDrawdownPct: number;
  trades: number;
  rangeStart: string;
  rangeEnd: string;
  profitFactor?: number;
  sharpe?: number;
  initialCapital?: number;
  finalCapital?: number;
};

export type UploadedBacktestEquityPoint = {
  /** ISO timestamp. */
  t: string;
  /** Equity value (currency or %, set by `summary.initialCapital`). */
  v: number;
};

export type UploadedBacktestTrade = {
  entryTime: string;
  exitTime: string;
  side: "long" | "short";
  entry: number;
  exit: number;
  qty: number;
  pnl: number;
  pnlPct: number;
};

export type UploadedBacktest = {
  summary: UploadedBacktestSummary;
  equity: UploadedBacktestEquityPoint[];
  trades: UploadedBacktestTrade[];
};

export type UploadedBacktestKind = "json" | "tv_export";

export type UploadedBacktestMeta = {
  /** Where the payload originated, mirrors `backtest_upload_kind`. */
  source: UploadedBacktestKind;
  /** File / paste label shown in the UI. */
  fileName?: string;
  /** ISO timestamp of when we accepted the upload. */
  uploadedAt: string;
  /** Optional date range the data covers — falls back to `summary.range*`. */
  ranges?: { start: string; end: string };
  /** Bumped when we change the on-disk shape (forward-compat). */
  version: number;
};

export const UPLOADED_BACKTEST_VERSION = 1;
/** Hard ceiling on POST body size before we bother parsing. */
export const UPLOAD_MAX_BYTES = 1_000_000; // 1 MB
/** Trades are capped server-side to keep payloads bounded for the panel. */
export const UPLOAD_MAX_TRADES = 5_000;
/** Equity sampling cap for the same reason. */
export const UPLOAD_MAX_EQUITY_POINTS = 10_000;

export type UploadedBacktestValidation =
  | { ok: true; value: UploadedBacktest }
  | { ok: false; status: 400; code: string; message: string };

function fail(code: string, message: string): UploadedBacktestValidation {
  return { ok: false, status: 400, code, message };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function asIsoString(v: unknown, field: string): string | { error: string } {
  if (typeof v !== "string" || !v.trim()) {
    return { error: `${field} must be a non-empty ISO date string` };
  }
  const ms = new Date(v).getTime();
  if (!Number.isFinite(ms)) {
    return { error: `${field} is not a parseable date (got "${v}")` };
  }
  return new Date(ms).toISOString();
}

function asSide(v: unknown): "long" | "short" | { error: string } {
  if (typeof v !== "string") return { error: "trade.side must be a string" };
  const s = v.trim().toLowerCase();
  if (s === "long" || s === "buy" || s === "l") return "long";
  if (s === "short" || s === "sell" || s === "s") return "short";
  return { error: `trade.side must be "long" or "short" (got "${v}")` };
}

/**
 * Normalises a creator-supplied backtest payload. Accepts the canonical
 * `UploadedBacktest` shape verbatim; falls back to a small set of common
 * alternative spellings (e.g. `total_return_pct` snake_case, `win_rate`
 * fraction in [0,1]) so creators don't need to hand-massage every export.
 */
export function validateUploadedBacktest(
  raw: unknown
): UploadedBacktestValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("UPLOAD_NOT_OBJECT", "Backtest payload must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  const summaryRaw = obj.summary;
  if (!summaryRaw || typeof summaryRaw !== "object" || Array.isArray(summaryRaw)) {
    return fail("UPLOAD_SUMMARY_MISSING", "`summary` is required");
  }
  const s = summaryRaw as Record<string, unknown>;

  const totalReturnPct =
    pickNumber(s, ["totalReturnPct", "total_return_pct", "totalReturn"]);
  if (totalReturnPct === null) {
    return fail(
      "UPLOAD_SUMMARY_FIELD",
      "summary.totalReturnPct is required (number, e.g. 12.34)"
    );
  }

  let winRatePct = pickNumber(s, ["winRatePct", "win_rate_pct", "winRate"]);
  if (winRatePct === null) {
    return fail(
      "UPLOAD_SUMMARY_FIELD",
      "summary.winRatePct is required (number, e.g. 56.78)"
    );
  }
  // Tolerate fractions in [0, 1] and rescale to a percentage.
  if (winRatePct >= 0 && winRatePct <= 1) winRatePct = winRatePct * 100;

  const maxDrawdownPct =
    pickNumber(s, ["maxDrawdownPct", "max_drawdown_pct", "maxDrawdown"]);
  if (maxDrawdownPct === null) {
    return fail(
      "UPLOAD_SUMMARY_FIELD",
      "summary.maxDrawdownPct is required (number, positive)"
    );
  }

  const tradesCount = pickNumber(s, ["trades", "tradesCount", "totalTrades"]);
  if (tradesCount === null) {
    return fail(
      "UPLOAD_SUMMARY_FIELD",
      "summary.trades is required (count of closed trades)"
    );
  }

  const startIso = asIsoString(
    s.rangeStart ?? s.range_start ?? s.startDate,
    "summary.rangeStart"
  );
  if (typeof startIso !== "string") return fail("UPLOAD_RANGE_START", startIso.error);

  const endIso = asIsoString(
    s.rangeEnd ?? s.range_end ?? s.endDate,
    "summary.rangeEnd"
  );
  if (typeof endIso !== "string") return fail("UPLOAD_RANGE_END", endIso.error);

  const summary: UploadedBacktestSummary = {
    totalReturnPct,
    winRatePct,
    maxDrawdownPct,
    trades: Math.max(0, Math.floor(tradesCount)),
    rangeStart: startIso,
    rangeEnd: endIso,
  };
  const profitFactor = pickNumber(s, ["profitFactor", "profit_factor"]);
  if (profitFactor !== null) summary.profitFactor = profitFactor;
  const sharpe = pickNumber(s, ["sharpe", "sharpeRatio", "sharpe_ratio"]);
  if (sharpe !== null) summary.sharpe = sharpe;
  const initialCapital = pickNumber(s, ["initialCapital", "initial_capital"]);
  if (initialCapital !== null) summary.initialCapital = initialCapital;
  const finalCapital = pickNumber(s, ["finalCapital", "final_capital"]);
  if (finalCapital !== null) summary.finalCapital = finalCapital;

  // Equity curve — optional but strongly recommended; we accept either an
  // already-shaped array or a list of `[t, v]` tuples.
  const equity: UploadedBacktestEquityPoint[] = [];
  if (Array.isArray(obj.equity)) {
    if (obj.equity.length > UPLOAD_MAX_EQUITY_POINTS) {
      return fail(
        "UPLOAD_EQUITY_TOO_LARGE",
        `equity has ${obj.equity.length} points (cap: ${UPLOAD_MAX_EQUITY_POINTS})`
      );
    }
    for (let i = 0; i < obj.equity.length; i++) {
      const pt = obj.equity[i];
      let t: unknown;
      let v: unknown;
      if (Array.isArray(pt)) {
        t = pt[0];
        v = pt[1];
      } else if (pt && typeof pt === "object") {
        const p = pt as Record<string, unknown>;
        t = p.t ?? p.time ?? p.timestamp ?? p.date;
        v = p.v ?? p.value ?? p.equity;
      } else {
        return fail(
          "UPLOAD_EQUITY_ITEM",
          `equity[${i}] must be { t, v } or [t, v]`
        );
      }
      const tIso = asIsoString(t, `equity[${i}].t`);
      if (typeof tIso !== "string")
        return fail("UPLOAD_EQUITY_TIME", tIso.error);
      if (!isFiniteNumber(v)) {
        return fail(
          "UPLOAD_EQUITY_VALUE",
          `equity[${i}].v must be a finite number`
        );
      }
      equity.push({ t: tIso, v });
    }
  }

  // Trades — optional; capped to keep panel render bounded.
  const trades: UploadedBacktestTrade[] = [];
  if (Array.isArray(obj.trades)) {
    if (obj.trades.length > UPLOAD_MAX_TRADES) {
      return fail(
        "UPLOAD_TRADES_TOO_LARGE",
        `trades has ${obj.trades.length} entries (cap: ${UPLOAD_MAX_TRADES})`
      );
    }
    for (let i = 0; i < obj.trades.length; i++) {
      const tRaw = obj.trades[i];
      if (!tRaw || typeof tRaw !== "object" || Array.isArray(tRaw)) {
        return fail(
          "UPLOAD_TRADE_ITEM",
          `trades[${i}] must be an object`
        );
      }
      const t = tRaw as Record<string, unknown>;
      const entryTime = asIsoString(
        t.entryTime ?? t.entry_time ?? t.openTime ?? t.open_time,
        `trades[${i}].entryTime`
      );
      if (typeof entryTime !== "string")
        return fail("UPLOAD_TRADE_FIELD", entryTime.error);
      const exitTime = asIsoString(
        t.exitTime ?? t.exit_time ?? t.closeTime ?? t.close_time,
        `trades[${i}].exitTime`
      );
      if (typeof exitTime !== "string")
        return fail("UPLOAD_TRADE_FIELD", exitTime.error);

      const sideResult = asSide(t.side ?? t.direction ?? t.type);
      if (typeof sideResult !== "string")
        return fail("UPLOAD_TRADE_SIDE", sideResult.error);

      const entry = pickNumber(t, ["entry", "entryPrice", "entry_price", "openPrice"]);
      const exit = pickNumber(t, ["exit", "exitPrice", "exit_price", "closePrice"]);
      const qty = pickNumber(t, ["qty", "quantity", "size", "positionSize"]);
      const pnl = pickNumber(t, ["pnl", "profit", "netProfit", "net_profit"]);
      const pnlPctRaw = pickNumber(t, [
        "pnlPct",
        "pnl_pct",
        "profitPct",
        "returnPct",
      ]);
      if (entry === null) {
        return fail(
          "UPLOAD_TRADE_FIELD",
          `trades[${i}].entry is required (number)`
        );
      }
      if (exit === null) {
        return fail(
          "UPLOAD_TRADE_FIELD",
          `trades[${i}].exit is required (number)`
        );
      }
      if (qty === null) {
        return fail(
          "UPLOAD_TRADE_FIELD",
          `trades[${i}].qty is required (number)`
        );
      }
      if (pnl === null) {
        return fail(
          "UPLOAD_TRADE_FIELD",
          `trades[${i}].pnl is required (number)`
        );
      }
      let pnlPct = pnlPctRaw;
      if (pnlPct === null) {
        // Derive from entry/exit when missing.
        if (entry !== 0)
          pnlPct =
            ((sideResult === "long" ? exit - entry : entry - exit) / entry) * 100;
        else pnlPct = 0;
      }
      trades.push({
        entryTime,
        exitTime,
        side: sideResult,
        entry,
        exit,
        qty,
        pnl,
        pnlPct,
      });
    }
  }

  return {
    ok: true,
    value: {
      summary,
      equity,
      trades,
    },
  };
}

function pickNumber(
  source: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const v = source[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const cleaned = v.trim().replace(/[%$,\s]/g, "");
      if (!cleaned) continue;
      const n = parseFloat(cleaned);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
