import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, Users, Target, BarChart3, FlaskConical } from "lucide-react";
import { Link } from "react-router-dom";

interface StrategyCardProps {
  id: string;
  name: string;
  description: string;
  returns: number;
  risk: "low" | "medium" | "high";
  minCapital: number;
  subscribers: number;
  winRate: number;
  type?: "copy_trading" | "algo";
  delay?: number;
}

const riskColors = {
  low: "bg-profit/10 text-profit border-profit/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  high: "bg-loss/10 text-loss border-loss/20",
};

export default function StrategyCard({
  id,
  name,
  description,
  returns,
  risk,
  minCapital,
  subscribers,
  winRate,
  type = "algo",
  delay = 0,
}: StrategyCardProps) {
  return (
    <div
      className="group glass rounded-xl p-6 hover:border-primary/30 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-base mb-1">{name}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
        </div>
        <Badge className={`${riskColors[risk]} border text-xs font-medium`}>
          {risk}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div>
          <div className="flex items-center gap-1 text-muted-foreground mb-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="text-xs">Returns</span>
          </div>
          <p className={`font-mono font-semibold text-sm ${returns >= 0 ? "text-profit" : "text-loss"}`}>
            {returns >= 0 ? "+" : ""}{returns}%
          </p>
        </div>
        <div>
          <div className="flex items-center gap-1 text-muted-foreground mb-1">
            <Target className="w-3.5 h-3.5" />
            <span className="text-xs">Win Rate</span>
          </div>
          <p className="font-mono font-semibold text-sm">{winRate}%</p>
        </div>
        <div>
          <div className="flex items-center gap-1 text-muted-foreground mb-1">
            <Users className="w-3.5 h-3.5" />
            <span className="text-xs">Users</span>
          </div>
          <p className="font-mono font-semibold text-sm">{subscribers.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          Min. ${minCapital.toLocaleString()}
        </span>
        <div className="flex flex-wrap gap-2 justify-end">
          {type === "algo" && (
            <Link to={`/strategy/${id}#backtest`}>
              <Button size="sm" variant="outline" className="shadow-sm">
                <FlaskConical className="w-4 h-4 mr-2" />
                Backtest
              </Button>
            </Link>
          )}
          <Link to={`/strategy/${id}`}>
            <Button size="sm" className="group-hover:shadow-md group-hover:shadow-primary/20 transition-shadow">
              <BarChart3 className="w-4 h-4" />
              Subscribe
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
