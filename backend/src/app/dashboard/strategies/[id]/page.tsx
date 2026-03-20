"use client";

import { use } from "react";
import { StrategyDetail } from "@/components/dashboard/strategy-detail";

export default function AlgoStrategyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <div className="space-y-6">
      <StrategyDetail strategyId={id} />
    </div>
  );
}
