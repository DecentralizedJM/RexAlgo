import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { tradeLogs } from "@/lib/schema";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trades = await db
    .select({
      id: tradeLogs.id,
      source: tradeLogs.source,
      strategyId: tradeLogs.strategyId,
      orderId: tradeLogs.orderId,
      positionId: tradeLogs.positionId,
      symbol: tradeLogs.symbol,
      side: tradeLogs.side,
      quantity: tradeLogs.quantity,
      entryPrice: tradeLogs.entryPrice,
      exitPrice: tradeLogs.exitPrice,
      pnl: tradeLogs.pnl,
      notionalUsdt: tradeLogs.notionalUsdt,
      status: tradeLogs.status,
      closedAt: tradeLogs.closedAt,
      createdAt: tradeLogs.createdAt,
    })
    .from(tradeLogs)
    .where(eq(tradeLogs.userId, session.user.id))
    .orderBy(desc(tradeLogs.createdAt))
    .limit(250);

  return NextResponse.json({
    trades: trades.map((trade) => ({
      ...trade,
      closedAt: trade.closedAt?.toISOString() ?? null,
      createdAt: trade.createdAt.toISOString(),
    })),
  });
}
