/**
 * Parse a TradingView Strategy Tester export into our normalised
 * `UploadedBacktest` shape.
 *
 * TradingView lets users export two artefacts from the Strategy Tester
 * panel: a "List of Trades" CSV and a "Performance Summary" JSON. We accept
 * either, plus a JSON object that already carries our canonical shape (so
 * advanced users can hand-craft the payload and still go through this
 * route). Pine Script *execution* is not feasible server-side without a
 * Pine runtime, so this is the pragmatic substitute: parse the *result*,
 * not the script.
 *
 * Trade pairs:
 *   TradingView's "List of Trades" CSV has two rows per closed trade — the
 *   "Entry long/short" and the matching "Exit long/short". We pair them by
 *   their `Trade #` column. Any unpaired entries are skipped with a
 *   diagnostic in the returned summary.
 *
 * Returned shape feeds straight into `validateUploadedBacktest`, which
 * applies the same shape constraints used by the `"json"` upload kind. A
 * single normalised path keeps the studio + public detail panels simple.
 */
import {
  type UploadedBacktest,
  type UploadedBacktestTrade,
} from "./uploadSchema";

export type TvExportParseResult =
  | { ok: true; value: UploadedBacktest }
  | { ok: false; status: 400; code: string; message: string };

function fail(code: string, message: string): TvExportParseResult {
  return { ok: false, status: 400, code, message };
}

function detectSeparator(headerLine: string): "," | "\t" | ";" {
  const counts = {
    ",": (headerLine.match(/,/g) ?? []).length,
    "\t": (headerLine.match(/\t/g) ?? []).length,
    ";": (headerLine.match(/;/g) ?? []).length,
  };
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  if (counts[";"] > counts[","]) return ";";
  return ",";
}

/**
 * Minimal CSV row tokenizer for TradingView exports.
 *
 * TV only quotes cells containing commas or quotes — not embedded
 * newlines — so a line-based, single-pass scanner is enough. We support
 * doubled `""` inside quoted fields per RFC 4180.
 */
function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCleanNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[%\s]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand.toLowerCase());
    if (idx >= 0) return idx;
  }
  // Loose match — TradingView changes "Price USDT" / "Price USD" by
  // quote currency. Fall back to startsWith.
  for (let i = 0; i < lower.length; i++) {
    for (const cand of candidates) {
      if (lower[i].startsWith(cand.toLowerCase())) return i;
    }
  }
  return -1;
}

function parseTradingViewDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/"/g, "");
  if (!trimmed) return null;
  // TradingView formats dates as "YYYY-MM-DD HH:mm" UTC. Normalise to ISO
  // by injecting the `T` and `Z`.
  const isoCandidate = trimmed.includes("T")
    ? trimmed
    : trimmed.replace(" ", "T");
  const withZ = /[zZ]|[+-]\d{2}:?\d{2}$/.test(isoCandidate)
    ? isoCandidate
    : `${isoCandidate}Z`;
  const ms = new Date(withZ).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Detect whether `body` looks like our canonical JSON, a TV "Performance
 * Summary" JSON, or a CSV "List of Trades", and route to the matching
 * parser.
 */
export function parseTvExport(body: string): TvExportParseResult {
  const trimmed = body.trim();
  if (!trimmed) {
    return fail("TV_EMPTY", "Upload body was empty");
  }

  // JSON paths first — try to parse and switch on the shape.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      return fail(
        "TV_JSON_PARSE",
        `Could not parse JSON: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      // Canonical shape — caller will run `validateUploadedBacktest` itself,
      // so we forward as-is.
      if ("summary" in obj && ("equity" in obj || "trades" in obj)) {
        return { ok: true, value: obj as unknown as UploadedBacktest };
      }
      // TradingView Performance Summary JSON.
      if ("all" in obj || "long" in obj || "performance" in obj) {
        return parseTvPerformanceJson(obj);
      }
    }
    return fail(
      "TV_JSON_SHAPE",
      "Unrecognised JSON shape. Expected the RexAlgo backtest JSON or a TradingView Performance Summary export."
    );
  }

  // Otherwise treat the body as CSV (List of Trades).
  return parseTvTradesCsv(trimmed);
}

/**
 * Parse a TradingView "Performance Summary" export. TradingView emits a
 * single object with `all`, `long`, `short` sub-objects, each carrying
 * fields like `netProfitPercent`, `winningTrades`, `losingTrades`, etc.
 */
function parseTvPerformanceJson(
  obj: Record<string, unknown>
): TvExportParseResult {
  const all = (obj.all ?? obj.performance ?? obj) as
    | Record<string, unknown>
    | undefined;
  if (!all) {
    return fail(
      "TV_PERF_MISSING_ALL",
      "TradingView export missing the 'all' performance block"
    );
  }
  const num = (keys: string[]): number | null => {
    for (const k of keys) {
      const v = all[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        const n = parseCleanNumber(v);
        if (n !== null) return n;
      }
    }
    return null;
  };

  const totalReturnPct = num(["netProfitPercent", "totalReturnPct", "netProfit"]);
  const winningTrades = num(["numberOfWinningTrades", "winningTrades"]) ?? 0;
  const losingTrades = num(["numberOfLosingTrades", "losingTrades"]) ?? 0;
  const totalTrades =
    num(["totalNumberOfTrades", "totalTrades"]) ??
    winningTrades + losingTrades;
  const winRatePct =
    totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const maxDrawdownPct = num(["maxDrawdownPercent", "maxDrawdown"]) ?? 0;
  const profitFactor = num(["profitFactor"]);
  const sharpe = num(["sharpeRatio", "sharpe"]);

  if (totalReturnPct === null) {
    return fail(
      "TV_PERF_MISSING_RETURN",
      "TradingView export missing 'netProfitPercent' / total return percent"
    );
  }

  return {
    ok: true,
    value: {
      summary: {
        totalReturnPct,
        winRatePct,
        maxDrawdownPct,
        trades: totalTrades,
        rangeStart:
          (typeof obj.rangeStart === "string" && obj.rangeStart) ||
          new Date(0).toISOString(),
        rangeEnd:
          (typeof obj.rangeEnd === "string" && obj.rangeEnd) ||
          new Date().toISOString(),
        ...(profitFactor !== null ? { profitFactor } : {}),
        ...(sharpe !== null ? { sharpe } : {}),
      },
      equity: [],
      trades: [],
    },
  };
}

/**
 * Parse a TradingView "List of Trades" CSV. Every closed round-trip is
 * represented as two rows sharing a `Trade #`: an entry and an exit.
 */
function parseTvTradesCsv(text: string): TvExportParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return fail("TV_CSV_EMPTY", "CSV must have a header row and at least one data row");
  }
  const sep = detectSeparator(lines[0]);
  const headers = parseCsvLine(lines[0], sep);
  if (headers.length < 4) {
    return fail("TV_CSV_HEADER", "CSV header row looks too short to be a TradingView export");
  }

  const idx = {
    tradeNum: findHeaderIndex(headers, ["Trade #", "Trade#", "Trade No"]),
    type: findHeaderIndex(headers, ["Type"]),
    dateTime: findHeaderIndex(headers, ["Date/Time", "Date", "Time"]),
    price: findHeaderIndex(headers, ["Price USDT", "Price", "Price USD"]),
    contracts: findHeaderIndex(headers, ["Contracts", "Quantity", "Position size"]),
    profitPct: findHeaderIndex(headers, [
      "Profit %",
      "Net Profit %",
      "P&L %",
      "PnL %",
    ]),
    profit: findHeaderIndex(headers, ["Profit", "Net Profit", "P&L", "PnL"]),
    cumulativeProfit: findHeaderIndex(headers, [
      "Cumulative profit",
      "Cum. P&L",
      "Cumulative P&L",
    ]),
  };

  if (
    idx.tradeNum < 0 ||
    idx.type < 0 ||
    idx.dateTime < 0 ||
    idx.price < 0 ||
    idx.contracts < 0
  ) {
    return fail(
      "TV_CSV_HEADER",
      "Could not locate required columns (Trade #, Type, Date/Time, Price, Contracts) in the CSV header"
    );
  }

  type Half = {
    tradeNum: string;
    type: string;
    when: string;
    price: number;
    qty: number;
    profit: number | null;
    profitPct: number | null;
    cumProfit: number | null;
  };
  const halves = new Map<string, { entry?: Half; exit?: Half }>();

  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li], sep);
    if (cells.every((c) => !c)) continue;

    const tradeNum = cells[idx.tradeNum]?.trim();
    const typeRaw = cells[idx.type]?.trim();
    if (!tradeNum || !typeRaw) continue;

    const when = parseTradingViewDate(cells[idx.dateTime]);
    if (!when) continue;

    const price = parseCleanNumber(cells[idx.price]);
    const qty = parseCleanNumber(cells[idx.contracts]);
    if (price === null || qty === null) continue;

    const profit =
      idx.profit >= 0 ? parseCleanNumber(cells[idx.profit]) : null;
    const profitPct =
      idx.profitPct >= 0 ? parseCleanNumber(cells[idx.profitPct]) : null;
    const cumProfit =
      idx.cumulativeProfit >= 0
        ? parseCleanNumber(cells[idx.cumulativeProfit])
        : null;

    const half: Half = {
      tradeNum,
      type: typeRaw,
      when,
      price,
      qty,
      profit,
      profitPct,
      cumProfit,
    };
    const slot = halves.get(tradeNum) ?? {};
    if (typeRaw.toLowerCase().startsWith("entry")) slot.entry = half;
    else if (typeRaw.toLowerCase().startsWith("exit")) slot.exit = half;
    else if (typeRaw.toLowerCase().includes("open")) slot.entry = half;
    else if (typeRaw.toLowerCase().includes("close")) slot.exit = half;
    halves.set(tradeNum, slot);
  }

  const trades: UploadedBacktestTrade[] = [];
  const equity: { t: string; v: number }[] = [];
  let realised = 0;
  let wins = 0;

  // Sort numerically by Trade # if the column is numeric; otherwise by exit
  // time. This mirrors how TradingView orders the export.
  const ordered = [...halves.values()]
    .filter((p) => p.entry && p.exit)
    .sort((a, b) => {
      const at = new Date(a.exit!.when).getTime();
      const bt = new Date(b.exit!.when).getTime();
      return at - bt;
    });

  for (const pair of ordered) {
    const entry = pair.entry!;
    const exit = pair.exit!;
    const isShort = /short|sell/i.test(entry.type);
    const side: "long" | "short" = isShort ? "short" : "long";
    const pnl = exit.profit ?? 0;
    let pnlPct = exit.profitPct ?? null;
    if (pnlPct === null && entry.price !== 0) {
      pnlPct =
        ((side === "long" ? exit.price - entry.price : entry.price - exit.price) /
          entry.price) *
        100;
    }
    if (pnl > 0) wins++;
    realised += pnl;
    trades.push({
      entryTime: entry.when,
      exitTime: exit.when,
      side,
      entry: entry.price,
      exit: exit.price,
      qty: entry.qty,
      pnl,
      pnlPct: pnlPct ?? 0,
    });
    equity.push({
      t: exit.when,
      v: exit.cumProfit !== null ? exit.cumProfit : realised,
    });
  }

  if (trades.length === 0) {
    return fail(
      "TV_CSV_NO_TRADES",
      "No paired entry/exit rows were found. Make sure you exported the 'List of Trades' from TradingView."
    );
  }

  const totalReturnPct = equity.length > 0 && equity[0].v !== 0
    ? (realised / Math.max(Math.abs(equity[0].v), 1)) * 100
    : realised; // Fallback: treat raw realised as the percent.
  const winRatePct = (wins / trades.length) * 100;

  // Max drawdown of the equity curve in absolute terms, expressed back as
  // a percent of the running peak. Conservative default if the curve is
  // monotonic.
  let peak = -Infinity;
  let maxDdPct = 0;
  for (const pt of equity) {
    if (pt.v > peak) peak = pt.v;
    if (peak > 0) {
      const dd = ((peak - pt.v) / peak) * 100;
      if (dd > maxDdPct) maxDdPct = dd;
    }
  }

  return {
    ok: true,
    value: {
      summary: {
        totalReturnPct,
        winRatePct,
        maxDrawdownPct: maxDdPct,
        trades: trades.length,
        rangeStart: trades[0].entryTime,
        rangeEnd: trades[trades.length - 1].exitTime,
      },
      equity,
      trades,
    },
  };
}
