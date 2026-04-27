import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { validateSubscriptionMargin } from "@/lib/subscriptionMargin";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const body = (await req.json()) as {
      marginPerTrade?: unknown;
      marginCurrency?: unknown;
    };

    const margin = validateSubscriptionMargin({
      marginPerTrade: body.marginPerTrade,
      marginCurrency: body.marginCurrency,
    });
    if (!margin.ok) {
      return NextResponse.json(
        { error: margin.message, code: margin.code },
        { status: margin.status }
      );
    }

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, id), eq(subscriptions.userId, session.user.id))
      );

    if (!sub) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    if (!sub.isActive) {
      return NextResponse.json(
        { error: "Cannot update a cancelled subscription" },
        { status: 400 }
      );
    }

    await db
      .update(subscriptions)
      .set({ marginPerTrade: margin.amountString })
      .where(eq(subscriptions.id, id));

    return NextResponse.json({
      success: true,
      marginPerTrade: margin.amountString,
    });
  } catch (error) {
    console.error("Subscription PATCH error:", error);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}
