import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptions, strategies } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const subs = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, session.user.id));

    return NextResponse.json({ subscriptions: subs });
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

    await db
      .update(strategies)
      .set({ subscriberCount: sql`${strategies.subscriberCount} + 1` })
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

    await db
      .update(subscriptions)
      .set({ isActive: false })
      .where(eq(subscriptions.id, subscriptionId));

    await db
      .update(strategies)
      .set({ subscriberCount: sql`MAX(${strategies.subscriberCount} - 1, 0)` })
      .where(eq(strategies.id, sub.strategyId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    return NextResponse.json({ error: "Failed to unsubscribe" }, { status: 500 });
  }
}
