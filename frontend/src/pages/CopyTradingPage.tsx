import Navbar from "@/components/Navbar";
import TraderCard from "@/components/TraderCard";
import { PublicListingsPlaceholder } from "@/components/PublicListingsPlaceholder";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchStrategies, type ApiStrategy } from "@/lib/api";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { initials } from "@/lib/format";
import SEOMeta from "@/components/SEOMeta";
import { SITE_URL } from "@/lib/seo";

function mapCopyStrategy(s: ApiStrategy) {
  const maxDd = s.stoplossPct != null ? Math.min(30, s.stoplossPct * 2) : 12;
  return {
    id: s.id,
    name: s.creatorName,
    avatar: initials(s.creatorName),
    roi: s.totalPnl,
    winRate: s.winRate,
    maxDrawdown: maxDd,
    followers: s.subscriberCount,
    strategyName: s.name,
    symbol: s.symbol,
  };
}

export default function CopyTradingPage() {
  const [sort, setSort] = useState<"roi" | "followers" | "winRate">("roi");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["strategies", "copy"],
    queryFn: () => fetchStrategies({ type: "copy_trading" }),
    ...liveDataQueryOptions,
  });

  const rawCount = data?.strategies?.length ?? 0;

  const rows = (data?.strategies ?? [])
    .filter((s) => {
      const creator = (s.creatorName || "").trim().toLowerCase();
      const strategy = (s.name || "").trim().toLowerCase();
      if (creator.length < 2 || strategy.length < 2) return false;
      return true;
    })
    .map(mapCopyStrategy);
  const getSortValue = (
    row: (typeof rows)[number],
    key: "roi" | "followers" | "winRate"
  ) => {
    if (key === "roi") return Number.isFinite(row.roi) ? row.roi : 0;
    if (key === "followers") return Number.isFinite(row.followers) ? row.followers : 0;
    return Number.isFinite(row.winRate) ? row.winRate : 0;
  };
  const sorted = [...rows].sort((a, b) => getSortValue(b, sort) - getSortValue(a, sort));

  return (
    <div className="min-h-screen bg-background">
      <SEOMeta
        title="Crypto Copy Trading — Follow Top Traders on Mudrex Futures"
        description="Copy the best Mudrex Futures traders automatically. Set your margin, follow signals, and track performance across Bitcoin, Ethereum, and more."
        canonical={`${SITE_URL}/copy-trading`}
      />
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-2xl font-bold mb-1">Crypto Copy Trading</h1>
          <p className="text-sm text-muted-foreground">
            Follow expert Mudrex Futures traders. Open a listing to subscribe with your margin.
          </p>
        </div>

        {isError && (
          <div className="mb-10 flex justify-center">
            <PublicListingsPlaceholder
              listingKind="copy_trading"
              loadError={error as Error}
              retryQueryKeys={[["strategies", "copy"]]}
            />
          </div>
        )}

        {!isError && (
        <div className="flex gap-2 mb-8 animate-fade-up-delay-1 flex-wrap">
          {(["roi", "followers", "winRate"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                sort === s
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "roi" ? "Top ROI" : s === "followers" ? "Most followed" : "Best win rate"}
            </button>
          ))}
        </div>
        )}

        {!isError && isLoading && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-xl h-80 animate-pulse" />
            ))}
          </div>
        )}
        {!isError && !isLoading && sorted.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sorted.map((t, i) => (
              <TraderCard key={t.id} {...t} delay={i * 80} />
            ))}
          </div>
        )}

        {!isLoading && !isError && rawCount === 0 && (
          <div className="flex justify-center py-8">
            <PublicListingsPlaceholder listingKind="copy_trading" />
          </div>
        )}

        {!isLoading && !isError && rawCount > 0 && sorted.length === 0 && (
          <div className="text-center py-16 text-muted-foreground space-y-3">
            <p>No public copy-trading listings match our display rules yet.</p>
            <p className="text-sm">
              Approved creators publish from{" "}
              <Link to="/copy-trading/studio" className="text-primary hover:underline font-medium">
                Master studio
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
