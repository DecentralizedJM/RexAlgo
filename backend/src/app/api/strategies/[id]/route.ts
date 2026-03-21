import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    return NextResponse.json({ strategy });
  } catch (error) {
    console.error("Strategy fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch strategy" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const [existing] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!existing) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    if (existing.creatorId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as Record<string, unknown>;

    if ("type" in body || "creatorId" in body || "creator_id" in body) {
      return NextResponse.json(
        { error: "Cannot change type or creator" },
        { status: 400 }
      );
    }

    const patch: Partial<typeof strategies.$inferInsert> = {};

    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.symbol === "string") patch.symbol = body.symbol;
    if (body.side === "LONG" || body.side === "SHORT" || body.side === "BOTH") {
      patch.side = body.side;
    }
    if (typeof body.leverage === "string") patch.leverage = body.leverage;
    if (body.stoplossPct === null) {
      patch.stoplossPct = null;
    } else if (body.stoplossPct !== undefined) {
      const v = parseFloat(String(body.stoplossPct));
      if (!Number.isNaN(v)) patch.stoplossPct = v;
    }
    if (body.takeprofitPct === null) {
      patch.takeprofitPct = null;
    } else if (body.takeprofitPct !== undefined) {
      const v = parseFloat(String(body.takeprofitPct));
      if (!Number.isNaN(v)) patch.takeprofitPct = v;
    }
    if (body.riskLevel === "low" || body.riskLevel === "medium" || body.riskLevel === "high") {
      patch.riskLevel = body.riskLevel;
    }
    if (typeof body.timeframe === "string" || body.timeframe === null) {
      patch.timeframe = body.timeframe as string | null;
    }
    if (typeof body.isActive === "boolean") {
      patch.isActive = body.isActive;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    await db.update(strategies).set(patch).where(eq(strategies.id, id));

    const [updated] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    return NextResponse.json({ strategy: updated });
  } catch (error) {
    console.error("Strategy patch error:", error);
    return NextResponse.json({ error: "Failed to update strategy" }, { status: 500 });
  }
}
