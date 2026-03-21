import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

const MIN_MARGIN = 10;
const MAX_MARGIN = 500_000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await req.json();
    const marginPerTrade =
      typeof body.marginPerTrade === "string"
        ? body.marginPerTrade.trim()
        : body.marginPerTrade != null
          ? String(body.marginPerTrade).trim()
          : "";

    const n = parseFloat(marginPerTrade);
    if (!Number.isFinite(n) || n < MIN_MARGIN || n > MAX_MARGIN) {
      return NextResponse.json(
        { error: `marginPerTrade must be between ${MIN_MARGIN} and ${MAX_MARGIN} USDT` },
        { status: 400 }
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
      .set({ marginPerTrade: String(n) })
      .where(eq(subscriptions.id, id));

    return NextResponse.json({ success: true, marginPerTrade: String(n) });
  } catch (error) {
    console.error("Subscription PATCH error:", error);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}
