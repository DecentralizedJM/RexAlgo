import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import StrategyCard from "@/components/StrategyCard";
import { PublicListingsPlaceholder } from "@/components/PublicListingsPlaceholder";
import { fetchStrategies, type ApiStrategy } from "@/lib/api";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";

const riskFilters = ["all", "low", "medium", "high"] as const;

function mapStrategy(s: ApiStrategy) {
  const minCapital = Math.max(50, Math.round(100 / Math.max(1, parseFloat(s.leverage || "1"))));
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    returns: s.totalPnl,
    risk: s.riskLevel,
    minCapital,
    subscribers: s.subscriberCount,
    winRate: s.winRate,
    type: s.type,
  };
}

export default function MarketplacePage() {
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [sort, setSort] = useState<"returns" | "subscribers" | "winRate">("returns");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["strategies", "algo"],
    queryFn: () => fetchStrategies({ type: "algo" }),
    ...liveDataQueryOptions,
  });

  const strategies = data?.strategies ?? [];
  const activeList = strategies.filter((s) => {
    const normalizedName = (s.name || "").trim().toLowerCase();
    if (!s.isActive) return false;
    if (normalizedName.length < 2) return false;
    return true;
  });
  const getSortValue = (
    row: ApiStrategy,
    key: "returns" | "subscribers" | "winRate"
  ) => {
    if (key === "returns") return Number.isFinite(row.totalPnl) ? row.totalPnl : 0;
    if (key === "subscribers") {
      return Number.isFinite(row.subscriberCount) ? row.subscriberCount : 0;
    }
    return Number.isFinite(row.winRate) ? row.winRate : 0;
  };
  const filtered = activeList
    .filter((s) => riskFilter === "all" || s.riskLevel === riskFilter)
    .sort((a, b) => getSortValue(b, sort) - getSortValue(a, sort))
    .map(mapStrategy);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-2xl font-bold mb-1">Strategy marketplace</h1>
          <p className="text-sm text-muted-foreground">
            Algo listings. Subscribe with your margin per trade.
          </p>
        </div>

        {isError && (
          <div className="mb-10 flex justify-center">
            <PublicListingsPlaceholder
              listingKind="algo"
              loadError={error as Error}
              retryQueryKeys={[["strategies", "algo"]]}
            />
          </div>
        )}

        {!isError && (
        <>
        <div className="flex flex-col sm:flex-row gap-4 mb-8 animate-fade-up-delay-1">
          <div className="flex gap-2 flex-wrap">
            {riskFilters.map((r) => (
              <button
                key={r}
                onClick={() => setRiskFilter(r)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 capitalize ${
                  riskFilter === r
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {r === "all" ? "All risks" : r}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="bg-secondary text-foreground rounded-lg px-4 py-2 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="returns">Sort by returns</option>
            <option value="subscribers">Sort by popularity</option>
            <option value="winRate">Sort by win rate</option>
          </select>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-xl h-72 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((s, i) => (
              <StrategyCard key={s.id} {...s} delay={i * 80} />
            ))}
          </div>
        )}
        </>
        )}

        {!isLoading && !isError && strategies.length === 0 && (
          <div className="flex justify-center py-8">
            <PublicListingsPlaceholder listingKind="algo" />
          </div>
        )}

        {!isLoading && strategies.length > 0 && activeList.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            All algo listings are paused. Creators can re-enable them in Strategy studio.
          </div>
        )}

        {!isLoading && activeList.length > 0 && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No strategies match your filters.
          </div>
        )}
      </div>
    </div>
  );
}
