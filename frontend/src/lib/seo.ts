export const SITE_URL = "https://rexalgo.xyz";
export const SITE_NAME = "RexAlgo";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

export const SEO_DEFAULTS = {
  title: "RexAlgo — Algorithmic & Copy Trading on Mudrex Futures",
  description:
    "Run algorithmic strategies and copy-trade top traders on Mudrex Futures. No code needed. Browse 850+ strategies, backtest in minutes.",
  image: DEFAULT_OG_IMAGE,
  url: SITE_URL,
};

export interface StrategyForMeta {
  id: string;
  name: string;
  description?: string | null;
  symbol?: string | null;
  type: "copy_trading" | "algo";
  winRate?: number | null;
  subscriberCount?: number | null;
  riskLevel?: string | null;
}

export function strategyMeta(s: StrategyForMeta) {
  const typeLabel = s.type === "copy_trading" ? "Copy Trading" : "Algo";
  const symbolPart = s.symbol ? ` ${s.symbol}` : "";
  const title = `${s.name} —${symbolPart} ${typeLabel} Strategy | ${SITE_NAME}`;

  const parts: string[] = [];
  if (s.description) parts.push(s.description.slice(0, 120));
  if (s.winRate != null) parts.push(`Win rate ${s.winRate}%`);
  if (s.subscriberCount != null) parts.push(`${s.subscriberCount} subscribers`);
  if (s.symbol) parts.push(`Trade ${s.symbol} on Mudrex Futures`);
  const description = parts.join(". ").replace(/\.\./g, ".") || SEO_DEFAULTS.description;

  const canonical = `${SITE_URL}/strategy/${s.id}`;
  // Dynamic OG image served from the API
  const image = `${SITE_URL}/api/og/strategy/${s.id}`;

  return { title, description, canonical, image };
}
