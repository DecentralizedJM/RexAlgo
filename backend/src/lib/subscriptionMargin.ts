/**
 * Shared validation for subscription `marginPerTrade` + `marginCurrency`.
 *
 * Why centralized:
 * - `POST /api/subscriptions` and `PATCH /api/subscriptions/[id]` historically
 *   diverged (POST had no numeric checks; PATCH had its own `MIN_MARGIN`).
 * - The execution path in `src/lib/copyMirror.ts` interprets `marginPerTrade`
 *   as USDT today. Letting the client persist anything else would silently
 *   ship wrong-sized orders to Mudrex.
 *
 * Bounds:
 * - USDT: `[10, 500_000]` matches the live Mudrex futures lower/upper bounds
 *   we already enforce in the legacy PATCH route.
 * - INR: defined for forward-compat but `enabled: false` until Mudrex INR
 *   futures launch. Bounds reflect what the marketing copy advertises
 *   (₹1,000 minimum) so the response message stays in sync with the UI.
 */
export type SubscriptionMarginCurrency = "USDT" | "INR";

export interface SubscriptionMarginConfig {
  code: SubscriptionMarginCurrency;
  min: number;
  max: number;
  enabled: boolean;
}

export const SUBSCRIPTION_MARGIN_CONFIG: Record<
  SubscriptionMarginCurrency,
  SubscriptionMarginConfig
> = {
  USDT: { code: "USDT", min: 10, max: 500_000, enabled: true },
  INR: { code: "INR", min: 1_000, max: 5_00_00_000, enabled: false },
};

export const DEFAULT_SUBSCRIPTION_MARGIN_CURRENCY: SubscriptionMarginCurrency =
  "USDT";

/** Discriminated result so callers can branch without try/catch. */
export type SubscriptionMarginValidation =
  | {
      ok: true;
      marginCurrency: SubscriptionMarginCurrency;
      /** Normalized numeric value, ready to persist as a string. */
      amount: number;
      /** Stringified `amount` — matches how the column is stored. */
      amountString: string;
    }
  | {
      ok: false;
      status: 400 | 409;
      code:
        | "MARGIN_INVALID"
        | "MARGIN_OUT_OF_RANGE"
        | "MARGIN_CURRENCY_INVALID"
        | "INR_MARGIN_COMING_SOON";
      message: string;
    };

function parseCurrency(
  raw: unknown
): SubscriptionMarginCurrency | "invalid" | "missing" {
  if (raw == null || raw === "") return "missing";
  if (typeof raw !== "string") return "invalid";
  const upper = raw.trim().toUpperCase();
  if (upper === "USDT" || upper === "INR") return upper;
  return "invalid";
}

function parseAmount(raw: unknown): number | null {
  const trimmed =
    typeof raw === "string"
      ? raw.trim()
      : raw != null
        ? String(raw).trim()
        : "";
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate `{ marginPerTrade, marginCurrency }` for create/update.
 *
 * `marginCurrency` is optional on input — missing values default to
 * {@link DEFAULT_SUBSCRIPTION_MARGIN_CURRENCY} for backward compatibility with
 * older clients that only send `marginPerTrade`.
 */
export function validateSubscriptionMargin(input: {
  marginPerTrade: unknown;
  marginCurrency?: unknown;
}): SubscriptionMarginValidation {
  const currencyResult = parseCurrency(input.marginCurrency);
  if (currencyResult === "invalid") {
    return {
      ok: false,
      status: 400,
      code: "MARGIN_CURRENCY_INVALID",
      message: "marginCurrency must be 'USDT' or 'INR'",
    };
  }
  const currency: SubscriptionMarginCurrency =
    currencyResult === "missing"
      ? DEFAULT_SUBSCRIPTION_MARGIN_CURRENCY
      : currencyResult;

  const config = SUBSCRIPTION_MARGIN_CONFIG[currency];

  if (!config.enabled) {
    return {
      ok: false,
      status: 409,
      code: "INR_MARGIN_COMING_SOON",
      message:
        "INR margin is coming soon. Please use USDT for now — Mudrex INR futures aren’t enabled yet.",
    };
  }

  const amount = parseAmount(input.marginPerTrade);
  if (amount === null) {
    return {
      ok: false,
      status: 400,
      code: "MARGIN_INVALID",
      message: "marginPerTrade must be a positive number",
    };
  }

  if (amount < config.min || amount > config.max) {
    return {
      ok: false,
      status: 400,
      code: "MARGIN_OUT_OF_RANGE",
      message: `marginPerTrade must be between ${config.min} and ${config.max} ${config.code}`,
    };
  }

  return {
    ok: true,
    marginCurrency: currency,
    amount,
    amountString: String(amount),
  };
}
