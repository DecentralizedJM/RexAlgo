"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Strategy } from "@/types";

const riskColors = {
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  high: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function StrategyCard({
  strategy,
  basePath,
}: {
  strategy: Strategy;
  basePath: string;
}) {
  const pnl = strategy.totalPnl;

  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Badge variant="outline" className={riskColors[strategy.riskLevel]}>
            {strategy.riskLevel}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {strategy.timeframe}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {strategy.side}
          </Badge>
        </div>
        <CardTitle className="text-base">{strategy.name}</CardTitle>
        <CardDescription className="text-xs">
          by {strategy.creatorName} &middot; {strategy.symbol}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground line-clamp-2">
          {strategy.description}
        </p>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div
              className={`text-sm font-bold ${
                pnl >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {pnl >= 0 ? "+" : ""}
              {pnl.toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground">PnL</div>
          </div>
          <div>
            <div className="text-sm font-bold">{strategy.winRate.toFixed(0)}%</div>
            <div className="text-[10px] text-muted-foreground">Win Rate</div>
          </div>
          <div>
            <div className="text-sm font-bold">{strategy.subscriberCount}</div>
            <div className="text-[10px] text-muted-foreground">Subs</div>
          </div>
        </div>

        <Link href={`${basePath}/${strategy.id}`}>
          <Button variant="outline" size="sm" className="w-full">
            View Details
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
