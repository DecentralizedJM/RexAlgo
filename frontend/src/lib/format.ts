/** BTCUSDT → BTC/USDT */
export function formatPair(symbol: string): string {
  if (symbol.endsWith("USDT")) {
    return `${symbol.slice(0, -4)}/USDT`;
  }
  if (symbol.endsWith("USD")) {
    return `${symbol.slice(0, -3)}/USD`;
  }
  return symbol;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
