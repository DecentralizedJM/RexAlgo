import type { WalletResponse } from "./api";

/** USDT in futures wallet minus locked margin (best-effort for copy / subscribe checks). */
export function futuresAvailableUsdt(wallet: WalletResponse | undefined): number {
  if (!wallet?.futures) return 0;
  const bal = parseFloat(wallet.futures.balance ?? "0");
  const locked = parseFloat(wallet.futures.locked_amount ?? "0");
  if (!Number.isFinite(bal)) return 0;
  const l = Number.isFinite(locked) ? locked : 0;
  return Math.max(0, bal - l);
}

/** Minimum margin per trade allowed when subscribing (matches AllocationModal slider). */
export const MIN_MARGIN_PER_TRADE_USD = 10;
