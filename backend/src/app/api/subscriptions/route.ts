import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptions, strategies } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        strategyId: subscriptions.strategyId,
        marginPerTrade: subscriptions.marginPerTrade,
        isActive: subscriptions.isActive,
        createdAt: subscriptions.createdAt,
        strategyName: strategies.name,
        strategyType: strategies.type,
        strategySymbol: strategies.symbol,
        strategyLeverage: strategies.leverage,
        strategyIsActive: strategies.isActive,
        strategyCreatorName: strategies.creatorName,
      })
      .from(subscriptions)
      .innerJoin(strategies, eq(subscriptions.strategyId, strategies.id))
      .where(eq(subscriptions.userId, session.user.id))
      .orderBy(desc(subscriptions.createdAt));

    const subscriptionsOut = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      strategyId: r.strategyId,
      marginPerTrade: r.marginPerTrade,
      isActive: r.isActive,
      createdAt: r.createdAt,
      strategy: {
        id: r.strategyId,
        name: r.strategyName,
        type: r.strategyType,
        symbol: r.strategySymbol,
        leverage: r.strategyLeverage,
        isActive: r.strategyIsActive,
        creatorName: r.strategyCreatorName,
      },
    }));

    return NextResponse.json({ subscriptions: subscriptionsOut });
  } catch (error) {
    console.error("Subscriptions fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { strategyId, marginPerTrade } = await req.json();

    if (!strategyId || !marginPerTrade) {
      return NextResponse.json(
        { error: "strategyId and marginPerTrade are required" },
        { status: 400 }
      );
    }

    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, strategyId));

    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    // Block subscriptions to strategies that have not passed admin review (or
    // that the creator has deactivated). The studio / admin dashboards never
    // use this endpoint so this does not affect owners.
    if (strategy.status !== "approved" || !strategy.isActive) {
      return NextResponse.json(
        {
          error:
            strategy.status === "approved"
              ? "Strategy is currently paused by its creator"
              : "Strategy is not available for subscription",
          code: "STRATEGY_NOT_AVAILABLE",
        },
        { status: 409 }
      );
    }

    const existing = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, session.user.id),
          eq(subscriptions.strategyId, strategyId),
          eq(subscriptions.isActive, true)
        )
      );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Already subscribed to this strategy" },
        { status: 409 }
      );
    }

    const id = uuidv4();
    await db.insert(subscriptions).values({
      id,
      userId: session.user.id,
      strategyId,
      marginPerTrade,
      isActive: true,
    });

    const [st] = await db
      .select({ c: strategies.subscriberCount })
      .from(strategies)
      .where(eq(strategies.id, strategyId));
    await db
      .update(strategies)
      .set({ subscriberCount: (st?.c ?? 0) + 1 })
      .where(eq(strategies.id, strategyId));

    return NextResponse.json({ success: true, subscriptionId: id }, { status: 201 });
  } catch (error) {
    console.error("Subscribe error:", error);
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { subscriptionId } = await req.json();

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.id, subscriptionId),
          eq(subscriptions.userId, session.user.id)
        )
      );

    if (!sub) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const wasActive = sub.isActive;

    await db
      .update(subscriptions)
      .set({ isActive: false })
      .where(eq(subscriptions.id, subscriptionId));

    if (wasActive) {
      const [st] = await db
        .select({ c: strategies.subscriberCount })
        .from(strategies)
        .where(eq(strategies.id, sub.strategyId));
      const next = Math.max(0, (st?.c ?? 1) - 1);
      await db
        .update(strategies)
        .set({ subscriberCount: next })
        .where(eq(strategies.id, sub.strategyId));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    return NextResponse.json({ error: "Failed to unsubscribe" }, { status: 500 });
  }
}
