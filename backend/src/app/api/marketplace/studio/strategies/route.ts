import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { desc, eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies, copyWebhookConfig } from "@/lib/schema";
import {
  defaultBacktestSpec,
  parseBacktestSpecFromBody,
  serializeBacktestSpec,
} from "@/lib/backtest/spec";
import { publicApiBase } from "@/lib/publicUrl";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  const rows = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.creatorId, session.user.id),
        eq(strategies.type, "algo")
      )
    )
    .orderBy(desc(strategies.createdAt));

  const allWh = await db.select().from(copyWebhookConfig);
  const whMap = new Map(allWh.map((w) => [w.strategyId, w]));

  const base = publicApiBase();

  const out = rows.map((s) => {
    const w = whMap.get(s.id);
    const path = `/api/webhooks/copy-trading/${s.id}`;
    return {
      ...s,
      webhookEnabled: w?.enabled ?? false,
      webhookName: w?.name ?? s.name,
      webhookLastDeliveryAt: w?.lastDeliveryAt?.toISOString() ?? null,
      webhookRotatedAt: w?.rotatedAt?.toISOString() ?? null,
      webhookUrl: base ? `${base}${path}` : null,
      webhookPath: path,
    };
  });

  return NextResponse.json({
    strategies: out,
    publicBaseUrl: base || null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  try {
    const body = await req.json();

    const id = uuidv4();
    const newStrategy = {
      id,
      creatorId: session.user.id,
      creatorName: session.user.displayName,
      name: body.name,
      description: body.description,
      type: "algo" as const,
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

    if (!newStrategy.name || !newStrategy.description || !newStrategy.symbol) {
      return NextResponse.json(
        { error: "name, description, and symbol are required" },
        { status: 400 }
      );
    }

    const spec =
      parseBacktestSpecFromBody(body.backtestSpec) ?? defaultBacktestSpec();

    await db.insert(strategies).values({
      ...newStrategy,
      backtestSpecJson: serializeBacktestSpec(spec),
    });

    const [created] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    const base = publicApiBase();
    const path = `/api/webhooks/copy-trading/${id}`;

    return NextResponse.json(
      {
        strategy: {
          ...created,
          webhookEnabled: false,
          webhookName: created.name,
          webhookLastDeliveryAt: null,
          webhookRotatedAt: null,
          webhookUrl: base ? `${base}${path}` : null,
          webhookPath: path,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Marketplace studio strategy create error:", error);
    return NextResponse.json({ error: "Failed to create strategy" }, { status: 500 });
  }
}
