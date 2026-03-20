"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StrategyCard } from "@/components/dashboard/strategy-card";
import type { Strategy } from "@/types";

export default function CopyTradingPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetchStrategies() {
      try {
        const res = await fetch("/api/strategies?type=copy_trading");
        if (res.ok) {
          const data = await res.json();
          setStrategies(data.strategies || []);
        }
      } catch (err) {
        console.error("Fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchStrategies();
  }, []);

  const filtered = strategies.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.symbol.toLowerCase().includes(search.toLowerCase()) ||
      s.creatorName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Copy Trading</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Follow top traders and mirror their strategies
          </p>
        </div>
        <Link href="/dashboard/copy-trading/create">
          <Button>Publish Strategy</Button>
        </Link>
      </div>

      <Input
        placeholder="Search by name, symbol, or trader..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md bg-background/50"
      />

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-64 rounded-lg bg-card/50 border border-border/50 animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-4">
            {strategies.length === 0
              ? "No copy trading strategies yet. Be the first to publish one!"
              : "No strategies match your search."}
          </p>
          <Link href="/dashboard/copy-trading/create">
            <Button>Create First Strategy</Button>
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              basePath="/dashboard/copy-trading"
            />
          ))}
        </div>
      )}
    </div>
  );
}
