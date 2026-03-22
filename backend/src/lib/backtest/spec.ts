/**
 * Strategy-bound backtest: engine key + params stored on `strategies.backtest_spec_json`.
 * Not user-facing venue or product names.
 */

export const BACKTEST_ENGINES = ["sma_cross"] as const;
export type BacktestEngine = (typeof BACKTEST_ENGINES)[number];

export type BacktestSpec = {
  engine: BacktestEngine;
  params: Record<string, number>;
};

const DEFAULT_SPEC: BacktestSpec = {
  engine: "sma_cross",
  params: { fastPeriod: 10, slowPeriod: 30 },
};

export function defaultBacktestSpec(): BacktestSpec {
  return { ...DEFAULT_SPEC, params: { ...DEFAULT_SPEC.params } };
}

export function parseBacktestSpecJson(raw: string | null | undefined): BacktestSpec | null {
  if (raw == null || raw === "") return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const engine = (o as { engine?: string }).engine;
    const params = (o as { params?: unknown }).params;
    if (engine !== "sma_cross") return null;
    if (!params || typeof params !== "object") return null;
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
  if (engine !== "sma_cross") return null;
  if (!params || typeof params !== "object") return null;
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
