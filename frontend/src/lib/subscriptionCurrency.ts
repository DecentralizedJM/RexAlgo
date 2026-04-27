/**
 * Currency model for strategy / copy-trading subscriptions.
 *
 * Mudrex futures only expose USDT today, so `USDT` is the only `enabled`
 * currency. INR is rendered as a visible, disabled "Coming soon" option until
 * Mudrex INR futures launch. The execution path in
 * `backend/src/lib/copyMirror.ts` interprets `marginPerTrade` as USDT, so the
 * server also rejects INR until that contract is supported end-to-end.
 */

export type MarginCurrency = "USDT" | "INR";

export interface MarginCurrencyOption {
  code: MarginCurrency;
  label: string;
  symbol: string;
  /** Inclusive lower bound shown in the slider/input. */
  min: number;
  /** Inclusive upper bound for the slider; backend may allow more. */
  max: number;
  step: number;
  enabled: boolean;
  /** Suffix rendered in copy text after the formatted amount, e.g. "USDT". */
  unitSuffix: string;
}

export const MARGIN_CURRENCIES: Record<MarginCurrency, MarginCurrencyOption> = {
  USDT: {
    code: "USDT",
    label: "USDT margin",
    symbol: "$",
    min: 10,
    max: 5_000,
    step: 10,
    enabled: true,
    unitSuffix: "USDT",
  },
  INR: {
    code: "INR",
    // Mudrex INR futures are not live yet — kept here so the UI can advertise
    // it as a disabled "Coming soon" option without forking the layout.
    label: "INR margin",
    symbol: "\u20B9",
    min: 1_000,
    max: 5_00_000,
    step: 100,
    enabled: false,
    unitSuffix: "INR",
  },
};

/** Locale-aware amount formatter that includes the currency symbol. */
export function formatMarginAmount(
  currency: MarginCurrency,
  amount: number
): string {
  const opt = MARGIN_CURRENCIES[currency];
  const safe = Number.isFinite(amount) ? amount : 0;
  const locale = currency === "INR" ? "en-IN" : "en-US";
  return `${opt.symbol}${safe.toLocaleString(locale)}`;
}

/** Returns the option for a currency, defaulting to USDT for unknown values. */
export function getMarginCurrencyOption(
  currency: MarginCurrency | string | null | undefined
): MarginCurrencyOption {
  if (currency === "INR") return MARGIN_CURRENCIES.INR;
  return MARGIN_CURRENCIES.USDT;
}
