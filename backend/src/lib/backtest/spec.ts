/**
 * Strategy-bound backtest: engine key + params stored on `strategies.backtest_spec_json`.
 * Not user-facing venue or product names.
 */

export const BACKTEST_ENGINES = ["sma_cross", "rule_builder_v1"] as const;
export type BacktestEngine = (typeof BACKTEST_ENGINES)[number];

export type BacktestSpec =
  | {
      engine: "sma_cross";
      params: { fastPeriod: number; slowPeriod: number };
    }
  | {
      engine: "rule_builder_v1";
      params: {
        indicator: "sma" | "ema" | "rsi";
        period: number;
        comparator: "cross_above" | "cross_below" | "above" | "below";
        threshold: number;
        exitComparator?: "cross_above" | "cross_below" | "above" | "below";
        exitThreshold?: number;
      };
    };

const DEFAULT_SPEC: BacktestSpec = {
  engine: "rule_builder_v1",
  params: {
    indicator: "sma",
    period: 20,
    comparator: "cross_above",
    threshold: 0,
    exitComparator: "cross_below",
    exitThreshold: 0,
  },
};

export function defaultBacktestSpec(): BacktestSpec {
  return DEFAULT_SPEC.engine === "sma_cross"
    ? { engine: "sma_cross", params: { ...DEFAULT_SPEC.params } }
    : { engine: "rule_builder_v1", params: { ...DEFAULT_SPEC.params } };
}

export function parseBacktestSpecJson(raw: string | null | undefined): BacktestSpec | null {
  if (raw == null || raw === "") return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const engine = (o as { engine?: string }).engine;
    const params = (o as { params?: unknown }).params;
    if (engine !== "sma_cross" && engine !== "rule_builder_v1") return null;
    if (!params || typeof params !== "object") return null;
    if (engine === "rule_builder_v1") return parseRuleBuilderParams(params);
    const fastPeriod = Number((params as { fastPeriod?: unknown }).fastPeriod);
    const slowPeriod = Number((params as { slowPeriod?: unknown }).slowPeriod);
    if (
      !Number.isInteger(fastPeriod) ||
      !Number.isInteger(slowPeriod) ||
      fastPeriod < 2 ||
      slowPeriod < 2 ||
      fastPeriod >= slowPeriod
    ) {
      return null;
    }
    return { engine: "sma_cross", params: { fastPeriod, slowPeriod } };
  } catch {
    return null;
  }
}

export function serializeBacktestSpec(spec: BacktestSpec): string {
  return JSON.stringify(spec);
}

export function parseBacktestSpecFromBody(body: unknown): BacktestSpec | null {
  if (!body || typeof body !== "object") return null;
  const engine = (body as { engine?: string }).engine;
  const params = (body as { params?: unknown }).params;
  if (engine !== "sma_cross" && engine !== "rule_builder_v1") return null;
  if (!params || typeof params !== "object") return null;
  if (engine === "rule_builder_v1") return parseRuleBuilderParams(params);
  const fastPeriod = Number((params as { fastPeriod?: unknown }).fastPeriod);
  const slowPeriod = Number((params as { slowPeriod?: unknown }).slowPeriod);
  if (
    !Number.isInteger(fastPeriod) ||
    !Number.isInteger(slowPeriod) ||
    fastPeriod < 2 ||
    slowPeriod < 2 ||
    fastPeriod >= slowPeriod
  ) {
    return null;
  }
  return { engine: "sma_cross", params: { fastPeriod, slowPeriod } };
}

function parseComparator(v: unknown):
  | "cross_above"
  | "cross_below"
  | "above"
  | "below"
  | null {
  return v === "cross_above" || v === "cross_below" || v === "above" || v === "below"
    ? v
    : null;
}

function parseRuleBuilderParams(params: unknown): BacktestSpec | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  const indicator =
    p.indicator === "ema" || p.indicator === "rsi" || p.indicator === "sma"
      ? p.indicator
      : "sma";
  const period = Math.min(200, Math.max(2, Math.floor(Number(p.period) || 20)));
  const comparator = parseComparator(p.comparator) ?? "cross_above";
  const threshold = Number.isFinite(Number(p.threshold)) ? Number(p.threshold) : 0;
  const exitComparator = parseComparator(p.exitComparator ?? p.exit_comparator) ?? "cross_below";
  const exitThreshold = Number.isFinite(Number(p.exitThreshold ?? p.exit_threshold))
    ? Number(p.exitThreshold ?? p.exit_threshold)
    : 0;
  return {
    engine: "rule_builder_v1",
    params: { indicator, period, comparator, threshold, exitComparator, exitThreshold },
  };
}
