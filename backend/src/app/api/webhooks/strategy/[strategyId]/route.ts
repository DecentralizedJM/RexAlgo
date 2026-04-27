import { NextRequest, NextResponse } from "next/server";
import { postStrategySignalWebhook } from "@/lib/strategySignalWebhookIngress";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ strategyId: string }> }
) {
  const { strategyId } = await ctx.params;
  return postStrategySignalWebhook(req, strategyId);
}
