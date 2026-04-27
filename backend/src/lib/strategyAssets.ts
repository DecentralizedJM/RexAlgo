import { getAsset } from "@/lib/mudrex";

export type StrategyAssetMode = "single" | "multi";

const MAX_MULTI_SYMBOLS = 12;

export function normalizeStrategySymbol(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{2,30}$/.test(s)) return null;
  return s;
}

export function parseSymbolsJson(raw: string | null | undefined, fallback: string): string[] {
  if (!raw) return [fallback];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [fallback];
    const out = parsed
      .map(normalizeStrategySymbol)
      .filter((s): s is string => Boolean(s));
    return out.length > 0 ? Array.from(new Set(out)) : [fallback];
  } catch {
    return [fallback];
  }
}

export function serializeSymbols(symbols: string[]): string {
  return JSON.stringify(Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()))));
}

export function parseAssetSelection(raw: {
  assetMode?: unknown;
  symbol?: unknown;
  symbols?: unknown;
}): { ok: true; assetMode: StrategyAssetMode; symbols: string[]; primarySymbol: string } | { ok: false; error: string } {
  const assetMode: StrategyAssetMode = raw.assetMode === "multi" ? "multi" : "single";
  if (assetMode === "single") {
    const symbol = normalizeStrategySymbol(raw.symbol);
    if (!symbol) return { ok: false, error: "A valid Mudrex symbol is required" };
    return { ok: true, assetMode, symbols: [symbol], primarySymbol: symbol };
  }

  const arr = Array.isArray(raw.symbols) ? raw.symbols : [];
  const symbols = Array.from(new Set(arr.map(normalizeStrategySymbol).filter((s): s is string => Boolean(s))));
  if (symbols.length < 2) {
    return { ok: false, error: "Multi-asset strategies need at least two symbols" };
  }
  if (symbols.length > MAX_MULTI_SYMBOLS) {
    return { ok: false, error: `Multi-asset strategies can include up to ${MAX_MULTI_SYMBOLS} symbols` };
  }
  return { ok: true, assetMode, symbols, primarySymbol: symbols[0]! };
}

export async function validateMudrexSymbols(
  apiSecret: string,
  symbols: string[]
): Promise<{ ok: true } | { ok: false; error: string; invalid?: string }> {
  for (const symbol of symbols) {
    try {
      const asset = await getAsset(apiSecret, symbol, "interactive");
      if (!asset?.symbol || asset.is_active === false) {
        return { ok: false, error: `${symbol} is not active on Mudrex Futures`, invalid: symbol };
      }
    } catch {
      return { ok: false, error: `${symbol} is not available on Mudrex Futures`, invalid: symbol };
    }
  }
  return { ok: true };
}
