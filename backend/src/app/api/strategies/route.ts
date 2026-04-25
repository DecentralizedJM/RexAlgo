import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
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
import {
  PUBLIC_STRATEGIES_CACHE_TAG,
  revalidatePublicStrategiesList,
} from "@/lib/publicStrategiesCache";

const PUBLIC_STRATEGIES_REVALIDATE_SEC = Math.min(
  120,
  Math.max(1, Number.parseInt(process.env.REXALGO_PUBLIC_STRATEGIES_CACHE_SEC ?? "5", 10))
);

const loadPublicStrategies = unstable_cache(
  async (typeKey: string, creatorKey: string) => {
    const conditions = [
      eq(strategies.status, "approved" as const),
      eq(strategies.isActive, true),
    ];
    if (typeKey === "copy_trading" || typeKey === "algo") {
      conditions.push(eq(strategies.type, typeKey));
    }
    if (creatorKey !== "__all__" && creatorKey !== "__none__") {
      conditions.push(eq(strategies.creatorId, creatorKey));
    }
    if (creatorKey === "__none__") {
      return [] as (typeof strategies.$inferSelect)[];
    }
    return db
      .select()
      .from(strategies)
      .where(and(...conditions))
      .orderBy(desc(strategies.createdAt));
  },
  ["public-strategies-list-query"],
  {
    revalidate: PUBLIC_STRATEGIES_REVALIDATE_SEC,
    tags: [PUBLIC_STRATEGIES_CACHE_TAG],
  }
);

function listingCacheKeys(type: string | null, creatorId: string | null) {
  const typeKey =
    type === "copy_trading" || type === "algo" ? type : "__all__";
  if (!creatorId) return { typeKey, creatorKey: "__all__" as const };
  if (creatorId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(creatorId)) {
    return { typeKey, creatorKey: "__none__" as const };
  }
  return { typeKey, creatorKey: creatorId };
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  const creatorId = req.nextUrl.searchParams.get("creatorId");

  try {
    const { typeKey, creatorKey } = listingCacheKeys(type, creatorId);
    const filtered = await loadPublicStrategies(typeKey, creatorKey);

    return NextResponse.json(
      { strategies: filtered },
      {
        headers: {
          "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30",
        },
      }
    );
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

    revalidatePublicStrategiesList();

    return NextResponse.json({ strategy: created }, { status: 201 });
  } catch (error) {
    console.error("Strategy create error:", error);
    return NextResponse.json({ error: "Failed to create strategy" }, { status: 500 });
  }
}
