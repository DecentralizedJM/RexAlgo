/**
 * Runtime validation for strategy create/edit payloads.
 *
 * TypeScript types are discarded at compile time — we only have the `unknown`
 * JSON blob from the client. Without explicit validation, a user could POST
 * `{ name: null, leverage: 9999, type: "freestyle" }` and it would persist
 * verbatim, surfacing as UI-breaking rows, invalid Mudrex orders, or even
 * persisted script tags in the description.
 *
 * Every rule here is conservative on purpose: loosen a bound only after
 * exercising it against real traffic in staging.
 */

export type StrategyType = "copy_trading" | "algo";
export type StrategySide = "LONG" | "SHORT" | "BOTH";
export type StrategyRisk = "low" | "medium" | "high";

export type StrategyCreateInput = {
  name: string;
  description: string;
  type: StrategyType;
  symbol: string;
  side: StrategySide;
  leverage: string;
  stoplossPct: number | null;
  takeprofitPct: number | null;
  riskLevel: StrategyRisk;
  timeframe: string | null;
  backtestSpec?: unknown;
};

export type StrategyPatchInput = Partial<
  Omit<StrategyCreateInput, "type" | "backtestSpec">
> & {
  // type is immutable; backtestSpec is validated at a different layer.
  isActive?: boolean;
  backtestSpec?: unknown;
};

export type ValidationError = { field: string; message: string };

const NAME_MIN = 3;
const NAME_MAX = 100;
const DESC_MAX = 4000;
const SYMBOL_RE = /^[A-Z0-9._-]{2,20}$/;
const TIMEFRAME_RE = /^[0-9]{1,3}(m|h|d|w)$/;
const LEVERAGE_MIN = 1;
const LEVERAGE_MAX = 100;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateName(v: unknown, errs: ValidationError[]): string | undefined {
  if (typeof v !== "string") {
    errs.push({ field: "name", message: "name must be a string" });
    return;
  }
  const trimmed = v.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    errs.push({
      field: "name",
      message: `name must be between ${NAME_MIN} and ${NAME_MAX} characters`,
    });
    return;
  }
  return trimmed;
}

function validateDescription(
  v: unknown,
  errs: ValidationError[]
): string | undefined {
  if (typeof v !== "string") {
    errs.push({ field: "description", message: "description must be a string" });
    return;
  }
  if (v.length === 0 || v.length > DESC_MAX) {
    errs.push({
      field: "description",
      message: `description must be between 1 and ${DESC_MAX} characters`,
    });
    return;
  }
  return v;
}

function validateType(v: unknown, errs: ValidationError[]): StrategyType | undefined {
  if (v === "copy_trading" || v === "algo") return v;
  errs.push({
    field: "type",
    message: 'type must be one of "copy_trading" or "algo"',
  });
  return;
}

function validateSymbol(
  v: unknown,
  errs: ValidationError[]
): string | undefined {
  if (typeof v !== "string") {
    errs.push({ field: "symbol", message: "symbol must be a string" });
    return;
  }
  const normalized = v.trim().toUpperCase();
  if (!SYMBOL_RE.test(normalized)) {
    errs.push({
      field: "symbol",
      message: "symbol must be 2–20 chars of A–Z, 0–9, dot, underscore, or dash",
    });
    return;
  }
  return normalized;
}

function validateSide(v: unknown, errs: ValidationError[]): StrategySide | undefined {
  if (v === "LONG" || v === "SHORT" || v === "BOTH") return v;
  errs.push({
    field: "side",
    message: 'side must be one of "LONG", "SHORT", or "BOTH"',
  });
  return;
}

function validateLeverage(
  v: unknown,
  errs: ValidationError[]
): string | undefined {
  let asString: string;
  if (typeof v === "number") {
    asString = String(v);
  } else if (typeof v === "string") {
    asString = v.trim();
  } else {
    errs.push({ field: "leverage", message: "leverage must be a number" });
    return;
  }
  const n = Number.parseFloat(asString);
  if (!Number.isFinite(n) || n < LEVERAGE_MIN || n > LEVERAGE_MAX) {
    errs.push({
      field: "leverage",
      message: `leverage must be between ${LEVERAGE_MIN} and ${LEVERAGE_MAX}`,
    });
    return;
  }
  return asString;
}

function validatePct(
  v: unknown,
  field: string,
  errs: ValidationError[]
): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    errs.push({
      field,
      message: `${field} must be a percentage between 0 and 100`,
    });
    return;
  }
  return n;
}

function validateRiskLevel(
  v: unknown,
  errs: ValidationError[]
): StrategyRisk | undefined {
  if (v === "low" || v === "medium" || v === "high") return v;
  errs.push({
    field: "riskLevel",
    message: 'riskLevel must be one of "low", "medium", or "high"',
  });
  return;
}

function validateTimeframe(
  v: unknown,
  errs: ValidationError[]
): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !TIMEFRAME_RE.test(v)) {
    errs.push({
      field: "timeframe",
      message: "timeframe must look like 1m / 15m / 1h / 1d / 1w",
    });
    return;
  }
  return v;
}

/**
 * Full validation for strategy creation. Returns either a ready-to-insert
 * object or the list of all errors encountered (accumulate-then-report so a
 * form can show every problem at once).
 */
export function validateStrategyCreate(
  raw: unknown
):
  | { ok: true; input: StrategyCreateInput }
  | { ok: false; errors: ValidationError[] } {
  if (!isObject(raw)) {
    return { ok: false, errors: [{ field: "body", message: "body must be a JSON object" }] };
  }
  const errs: ValidationError[] = [];

  const name = validateName(raw.name, errs);
  const description = validateDescription(raw.description, errs);
  const type = validateType(raw.type, errs);
  const symbol = validateSymbol(raw.symbol, errs);
  const side = validateSide(raw.side, errs);
  const leverage = validateLeverage(raw.leverage ?? "1", errs);
  const stoplossPct = validatePct(raw.stoplossPct, "stoplossPct", errs);
  const takeprofitPct = validatePct(raw.takeprofitPct, "takeprofitPct", errs);
  const riskLevel = validateRiskLevel(raw.riskLevel ?? "medium", errs);
  const timeframe = validateTimeframe(raw.timeframe ?? "1h", errs);

  if (
    errs.length ||
    !name ||
    !description ||
    !type ||
    !symbol ||
    !side ||
    !leverage ||
    !riskLevel ||
    stoplossPct === undefined ||
    takeprofitPct === undefined ||
    timeframe === undefined
  ) {
    return { ok: false, errors: errs };
  }

  return {
    ok: true,
    input: {
      name,
      description,
      type,
      symbol,
      side,
      leverage,
      stoplossPct: stoplossPct ?? null,
      takeprofitPct: takeprofitPct ?? null,
      riskLevel,
      timeframe: timeframe ?? null,
      backtestSpec: raw.backtestSpec,
    },
  };
}

/**
 * Partial validation for PATCH. Only fields present in the request are
 * checked; returns the normalised subset. `type` is never accepted here —
 * the route layer explicitly rejects `type` changes.
 */
export function validateStrategyPatch(
  raw: unknown
):
  | { ok: true; patch: StrategyPatchInput }
  | { ok: false; errors: ValidationError[] } {
  if (!isObject(raw)) {
    return { ok: false, errors: [{ field: "body", message: "body must be a JSON object" }] };
  }
  const errs: ValidationError[] = [];
  const patch: StrategyPatchInput = {};

  if ("name" in raw) {
    const n = validateName(raw.name, errs);
    if (n) patch.name = n;
  }
  if ("description" in raw) {
    const d = validateDescription(raw.description, errs);
    if (d) patch.description = d;
  }
  if ("symbol" in raw) {
    const s = validateSymbol(raw.symbol, errs);
    if (s) patch.symbol = s;
  }
  if ("side" in raw) {
    const s = validateSide(raw.side, errs);
    if (s) patch.side = s;
  }
  if ("leverage" in raw) {
    const l = validateLeverage(raw.leverage, errs);
    if (l) patch.leverage = l;
  }
  if ("stoplossPct" in raw) {
    const v = validatePct(raw.stoplossPct, "stoplossPct", errs);
    if (v !== undefined) patch.stoplossPct = v;
  }
  if ("takeprofitPct" in raw) {
    const v = validatePct(raw.takeprofitPct, "takeprofitPct", errs);
    if (v !== undefined) patch.takeprofitPct = v;
  }
  if ("riskLevel" in raw) {
    const r = validateRiskLevel(raw.riskLevel, errs);
    if (r) patch.riskLevel = r;
  }
  if ("timeframe" in raw) {
    const t = validateTimeframe(raw.timeframe, errs);
    if (t !== undefined) patch.timeframe = t;
  }
  if ("isActive" in raw) {
    if (typeof raw.isActive !== "boolean") {
      errs.push({ field: "isActive", message: "isActive must be a boolean" });
    } else {
      patch.isActive = raw.isActive;
    }
  }
  if ("backtestSpec" in raw) {
    patch.backtestSpec = raw.backtestSpec;
  }

  if (errs.length) return { ok: false, errors: errs };
  return { ok: true, patch };
}
