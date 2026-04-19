/**
 * USDT linear perp unrealized P&amp;L (best-effort).
 * Assumes `quantity` is base-asset size (e.g. BTC for BTCUSDT), prices in USDT.
 * Does not include trading fees or funding accruals — those are venue-ledger items.
 */
export function linearUnrealizedPnlUsdt(opts: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
  quantity: number;
}): number | null {
  const { side, entryPrice, markPrice, quantity } = opts;
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(markPrice) ||
    !Number.isFinite(quantity)
  ) {
    return null;
  }
  if (entryPrice <= 0 || markPrice <= 0 || quantity <= 0) return null;
  const pnl =
    side === "SHORT"
      ? (entryPrice - markPrice) * quantity
      : (markPrice - entryPrice) * quantity;
  return pnl;
}
