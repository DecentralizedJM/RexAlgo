import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { and, eq, desc } from "drizzle-orm";
import {
  defaultBacktestSpec,
  parseBacktestSpecFromBody,
  serializeBacktestSpec,
} from "@/lib/backtest/spec";
import { validateStrategyCreate } from "@/lib/strategyValidation";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  const creatorId = req.nextUrl.searchParams.get("creatorId");

  try {
    // Push the approved-and-active gate into SQL so we don't hydrate
    // pending/rejected drafts into Node memory. Type + creatorId narrow
    // further at the query level instead of post-filtering in JS.
    const conditions = [
      eq(strategies.status, "approved" as const),
      eq(strategies.isActive, true),
    ];
    if (type === "copy_trading" || type === "algo") {
      conditions.push(eq(strategies.type, type));
    }
    if (creatorId) {
      conditions.push(eq(strategies.creatorId, creatorId));
    }

    const filtered = await db
      .select()
      .from(strategies)
      .where(and(...conditions))
      .orderBy(desc(strategies.createdAt));

    return NextResponse.json({ strategies: filtered });
  } catch (error) {
    console.error("Strategies fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch strategies" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = validateStrategyCreate(rawBody);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Invalid strategy input", code: "VALIDATION_FAILED", details: validation.errors },
      { status: 400 }
    );
  }
  const input = validation.input;

  try {
    const id = uuidv4();
    const specForAlgo =
      input.type === "algo"
        ? parseBacktestSpecFromBody(input.backtestSpec) ?? defaultBacktestSpec()
        : null;

    await db.insert(strategies).values({
      id,
      creatorId: session.user.id,
      creatorName: session.user.displayName,
      name: input.name,
      description: input.description,
      type: input.type,
      symbol: input.symbol,
      side: input.side,
      leverage: input.leverage,
      stoplossPct: input.stoplossPct,
      takeprofitPct: input.takeprofitPct,
      riskLevel: input.riskLevel,
      timeframe: input.timeframe ?? "1h",
      isActive: true,
      totalPnl: 0,
      winRate: 0,
      totalTrades: 0,
      subscriberCount: 0,
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
