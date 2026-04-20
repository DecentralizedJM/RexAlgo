import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import {
  defaultBacktestSpec,
  parseBacktestSpecFromBody,
  serializeBacktestSpec,
} from "@/lib/backtest/spec";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  const creatorId = req.nextUrl.searchParams.get("creatorId");

  try {
    const query = db.select().from(strategies).orderBy(desc(strategies.createdAt));

    const results = await query;

    // Public listings only show admin-approved, owner-active rows. Pending and
    // rejected strategies are surfaced exclusively via the studio endpoints
    // (where the creator can see their own drafts regardless of status).
    let filtered = results.filter(
      (s) => s.status === "approved" && s.isActive
    );
    if (type) {
      filtered = filtered.filter((s) => s.type === type);
    }
    if (creatorId) {
      filtered = filtered.filter((s) => s.creatorId === creatorId);
    }

    return NextResponse.json({ strategies: filtered });
  } catch (error) {
    console.error("Strategies fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch strategies" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();

    const id = uuidv4();
    const newStrategy = {
      id,
      creatorId: session.user.id,
      creatorName: session.user.displayName,
      name: body.name,
      description: body.description,
      type: body.type as "copy_trading" | "algo",
      symbol: body.symbol,
      side: body.side as "LONG" | "SHORT" | "BOTH",
      leverage: body.leverage || "1",
      stoplossPct: body.stoplossPct ? parseFloat(body.stoplossPct) : null,
      takeprofitPct: body.takeprofitPct ? parseFloat(body.takeprofitPct) : null,
      riskLevel: (body.riskLevel || "medium") as "low" | "medium" | "high",
      timeframe: body.timeframe || "1h",
      isActive: true,
      totalPnl: 0,
      winRate: 0,
      totalTrades: 0,
      subscriberCount: 0,
    };

    const specForAlgo =
      newStrategy.type === "algo"
        ? parseBacktestSpecFromBody(body.backtestSpec) ?? defaultBacktestSpec()
        : null;

    await db.insert(strategies).values({
      ...newStrategy,
      backtestSpecJson:
        specForAlgo != null ? serializeBacktestSpec(specForAlgo) : null,
    });

    const [created] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    return NextResponse.json({ strategy: created }, { status: 201 });
  } catch (error) {
    console.error("Strategy create error:", error);
    return NextResponse.json({ error: "Failed to create strategy" }, { status: 500 });
  }
}
