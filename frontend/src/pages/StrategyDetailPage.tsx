import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Navbar from "@/components/Navbar";
import PerformanceChart from "@/components/PerformanceChart";
import AllocationModal from "@/components/AllocationModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchStrategy, subscribe, ApiError } from "@/lib/api";
import { mockChartData } from "@/data/mockData";
import {
  TrendingUp,
  Target,
  Users,
  Shield,
  Activity,
  ArrowLeft,
  Play,
} from "lucide-react";
import { toast } from "sonner";

const riskColors = {
  low: "bg-profit/10 text-profit border-profit/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  high: "bg-loss/10 text-loss border-loss/20",
};

export default function StrategyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromCopy = searchParams.get("from") === "copy";
  const queryClient = useQueryClient();

  const [showAllocation, setShowAllocation] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["strategy", id],
    queryFn: () => fetchStrategy(id!),
    enabled: Boolean(id),
  });

  const strategy = data?.strategy;

  const backTo =
    fromCopy || strategy?.type === "copy_trading" ? "/copy-trading" : "/marketplace";
  const backLabel =
    fromCopy || strategy?.type === "copy_trading" ? "Copy trading" : "Marketplace";

  const metrics = strategy
    ? [
        {
          label: "Total PnL",
          value: `${strategy.totalPnl >= 0 ? "+" : ""}${strategy.totalPnl}%`,
          icon: TrendingUp,
          color: strategy.totalPnl >= 0 ? "text-profit" : "text-loss",
        },
        { label: "Win rate", value: `${strategy.winRate}%`, icon: Target, color: "text-foreground" },
        {
          label: "Max lev.",
          value: `${strategy.leverage}x`,
          icon: Shield,
          color: "text-foreground",
        },
        { label: "Trades", value: String(strategy.totalTrades), icon: Activity, color: "text-foreground" },
        {
          label: "Subscribers",
          value: strategy.subscriberCount.toLocaleString(),
          icon: Users,
          color: "text-foreground",
        },
        {
          label: "Symbol",
          value: strategy.symbol,
          icon: Activity,
          color: "text-foreground",
        },
      ]
    : [];

  async function handleSubscribe(amount: number) {
    if (!strategy) return;
    try {
      await subscribe(strategy.id, String(amount));
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      toast.success(`Subscribed with $${amount} margin per trade`);
      setShowAllocation(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        toast.error("Sign in to subscribe");
        navigate("/auth", { state: { from: `/strategy/${strategy.id}` } });
        return;
      }
      toast.error(e instanceof Error ? e.message : "Subscribe failed");
    }
  }

  if (isLoading || !id) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 pt-28 pb-16">
          <div className="glass rounded-xl h-96 animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError || !strategy) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 pt-28 pb-16 text-center text-muted-foreground">
          <p className="mb-4">{(error as Error)?.message || "Strategy not found"}</p>
          <Link to="/marketplace" className="text-primary hover:underline">
            Back to marketplace
          </Link>
        </div>
      </div>
    );
  }

  const chartData =
    strategy.totalTrades > 0
      ? mockChartData.map((d, i) => ({
          ...d,
          value: 35000 + strategy.totalPnl * 80 + i * 100,
        }))
      : mockChartData;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-16 max-w-4xl">
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to {backLabel}
        </Link>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 animate-fade-up">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-2xl font-bold">{strategy.name}</h1>
              <Badge className={`${riskColors[strategy.riskLevel]} border text-xs`}>
                {strategy.riskLevel} risk
              </Badge>
              <Badge variant="outline" className="text-xs">
                {strategy.type === "copy_trading" ? "Copy" : "Algo"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              by {strategy.creatorName} · {strategy.symbol} · {strategy.timeframe ?? "—"}
            </p>
            <p className="text-sm text-muted-foreground mt-2">{strategy.description}</p>
          </div>
          <Button variant="hero" size="sm" onClick={() => setShowAllocation(true)}>
            <Play className="w-4 h-4" />
            {strategy.type === "copy_trading" ? "Copy strategy" : "Subscribe"}
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
          {metrics.map((m, i) => (
            <div
              key={m.label}
              className="glass rounded-xl p-4 animate-fade-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <m.icon className="w-3.5 h-3.5" />
                <span className="text-xs">{m.label}</span>
              </div>
              <p className={`font-mono font-bold text-lg ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        <div className="glass rounded-xl p-6 mb-8 animate-fade-up-delay-2">
          <h2 className="font-semibold mb-4">Performance</h2>
          <PerformanceChart data={chartData} />
        </div>

        <div className="glass rounded-xl p-6 text-sm text-muted-foreground animate-fade-up-delay-3">
          <p>
            Execution is non-custodial: trades run on your Mudrex account via API. Past performance does
            not guarantee future results.
          </p>
        </div>
      </div>

      {showAllocation && (
        <AllocationModal
          mode="subscribe"
          strategyName={strategy.name}
          onClose={() => setShowAllocation(false)}
          onConfirm={(capital) => {
            void handleSubscribe(capital);
          }}
        />
      )}
    </div>
  );
}
