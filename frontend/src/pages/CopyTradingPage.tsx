import Navbar from "@/components/Navbar";
import TraderCard from "@/components/TraderCard";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchStrategies, type ApiStrategy } from "@/lib/api";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";
import { initials } from "@/lib/format";

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

  const rows = (data?.strategies ?? []).map(mapCopyStrategy);
  const sorted = [...rows].sort((a, b) => b[sort] - a[sort]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-2xl font-bold mb-1">Copy trading</h1>
          <p className="text-sm text-muted-foreground">
            Copy-trading listings. Open one to subscribe with your margin.
          </p>
        </div>

        {isError && (
          <div className="mb-6 p-4 rounded-xl bg-loss/10 border border-loss/20 text-sm text-loss">
            {(error as Error).message}. Check that the API is up and try again.
          </div>
        )}

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

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-xl h-80 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sorted.map((t, i) => (
              <TraderCard key={t.id} {...t} delay={i * 80} />
            ))}
          </div>
        )}

        {!isLoading && sorted.length === 0 && (
          <div className="text-center py-16 text-muted-foreground space-y-3">
            <p>No copy-trading strategies yet.</p>
            <p className="text-sm">
              Masters can publish a listing and webhook from{" "}
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
