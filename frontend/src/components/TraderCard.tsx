import { Button } from "@/components/ui/button";
import { TrendingUp, Users, Shield, Copy } from "lucide-react";
import { Link } from "react-router-dom";

interface TraderCardProps {
  id: string;
  name: string;
  avatar: string;
  roi: number;
  winRate: number;
  maxDrawdown: number;
  followers: number;
  strategyName?: string;
  symbol?: string;
  delay?: number;
}

export default function TraderCard({
  id,
  name,
  avatar,
  roi,
  winRate,
  maxDrawdown,
  followers,
  strategyName,
  symbol,
  delay = 0,
}: TraderCardProps) {
  return (
    <div
      className="group glass rounded-xl p-6 hover:border-primary/30 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-4 mb-5">
        <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-sm">
          {avatar}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold truncate">{name}</h3>
          {strategyName && (
            <p className="text-xs text-muted-foreground truncate">
              {strategyName}
              {symbol ? ` · ${symbol}` : ""}
            </p>
          )}
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Users className="w-3 h-3" /> {followers.toLocaleString()} subscribers
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-secondary/50 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
            <TrendingUp className="w-3 h-3" />
            <span className="text-[11px]">PnL</span>
          </div>
          <p className={`font-mono font-bold text-sm ${roi >= 0 ? "text-profit" : "text-loss"}`}>
            {roi >= 0 ? "+" : ""}
            {roi}%
          </p>
        </div>
        <div className="bg-secondary/50 rounded-lg p-3 text-center">
          <span className="text-[11px] text-muted-foreground">Win rate</span>
          <p className="font-mono font-bold text-sm">{winRate}%</p>
        </div>
        <div className="bg-secondary/50 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
            <Shield className="w-3 h-3" />
            <span className="text-[11px]">Est. DD</span>
          </div>
          <p className="font-mono font-bold text-sm text-loss">{maxDrawdown}%</p>
        </div>
      </div>

      <Link to={`/strategy/${id}?from=copy`}>
        <Button variant="outline" size="sm" className="w-full">
          <Copy className="w-4 h-4" />
          View & subscribe
        </Button>
      </Link>
    </div>
  );
}
