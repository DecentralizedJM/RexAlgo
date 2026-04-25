import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import {
  StrategySlotLimitError,
  assertStrategySlotAvailable,
} from "@/lib/quotas";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";

/**
 * POST /api/marketplace/studio/strategies/[id]/resubmit
 *
 * Transitions a rejected algo listing back to `pending` for re-review.
 * See the copy-trading variant for background; the marketplace path is
 * identical except for the enforced `type = algo` filter.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  const { id } = await ctx.params;

  const [existing] = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.id, id),
        eq(strategies.creatorId, session.user.id),
        eq(strategies.type, "algo")
      )
    );
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }
  if (existing.status !== "rejected") {
    return NextResponse.json(
      {
        error: "Only rejected listings can be resubmitted.",
        code: "STRATEGY_NOT_REJECTED",
        status: existing.status,
      },
      { status: 409 }
    );
  }

  try {
    await assertStrategySlotAvailable(session.user.id, "algo");
  } catch (err) {
    if (err instanceof StrategySlotLimitError) {
      return NextResponse.json(
        { error: err.message, code: err.code, used: err.used, limit: err.limit },
        { status: 409 }
      );
    }
    throw err;
  }

  await db
    .update(strategies)
    .set({
      status: "pending",
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
    })
    .where(eq(strategies.id, id));

  revalidatePublicStrategiesList();

  const [updated] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, id));

  return NextResponse.json({ ok: true, strategy: updated });
}
