import { SITE_URL } from "@/lib/seo";

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "RexAlgo",
    url: SITE_URL,
    logo: `${SITE_URL}/rexalgo-mark.png`,
    description:
      "Algorithmic and copy-trading platform for Mudrex Futures. No code needed.",
  };
}

export function webAppSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "RexAlgo",
    url: SITE_URL,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description:
      "Run algorithmic strategies and copy-trade top traders on Mudrex Futures. Browse 850+ strategies, backtest in minutes.",
  };
}

export function breadcrumbSchema(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export interface StrategySchemaOpts {
  id: string;
  name: string;
  description: string;
  symbol: string;
}

export function strategyProductSchema(s: StrategySchemaOpts) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: s.name,
    description: s.description,
    url: `${SITE_URL}/strategy/${s.id}`,
    category: "Trading Strategy",
    brand: {
      "@type": "Brand",
      name: "RexAlgo",
    },
  };
}
