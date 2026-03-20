"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StrategyCard } from "@/components/dashboard/strategy-card";
import type { Strategy } from "@/types";

export default function AlgoStrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");

  useEffect(() => {
    async function fetchStrategies() {
      try {
        const res = await fetch("/api/strategies?type=algo");
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

  const filtered = strategies.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.symbol.toLowerCase().includes(search.toLowerCase());
    const matchesRisk = riskFilter === "all" || s.riskLevel === riskFilter;
    return matchesSearch && matchesRisk;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Algo Strategies</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Subscribe to rule-based algorithmic strategies
          </p>
        </div>
        <Link href="/dashboard/strategies/create">
          <Button>Create Strategy</Button>
        </Link>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Search by name or symbol..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs bg-background/50"
        />
        <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v ?? "all")}>
          <SelectTrigger className="w-40 bg-background/50">
            <SelectValue placeholder="Risk Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Risk Levels</SelectItem>
            <SelectItem value="low">Low Risk</SelectItem>
            <SelectItem value="medium">Medium Risk</SelectItem>
            <SelectItem value="high">High Risk</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
              ? "No algo strategies yet. Create one to get started!"
              : "No strategies match your filters."}
          </p>
          <Link href="/dashboard/strategies/create">
            <Button>Create First Strategy</Button>
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              basePath="/dashboard/strategies"
            />
          ))}
        </div>
      )}
    </div>
  );
}
