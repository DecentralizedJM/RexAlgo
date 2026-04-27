import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies, copyWebhookConfig } from "@/lib/schema";
import { queueNotification } from "@/lib/notifications";
import { logAdminAudit } from "@/lib/adminAudit";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";

const MAX_REASON = 500;

/**
 * Approve or reject a single strategy (per-strategy review flow).
 *
 * Body: `{ action: "approve" | "reject", reason?: string }`
 *
 *   - `approve` — flips status to `approved`, records reviewer, and leaves
 *     the webhook as-is (owner may already have it enabled from draft setup).
 *   - `reject`  — flips status to `rejected` with the given reason, and
 *     proactively disables any existing webhook config so a rejected strategy
 *     can never accept live traffic. Owner sees the reason in the studio and
 *     may edit / resubmit / delete.
 *
 * Only already-pending strategies may be reviewed — re-reviewing an approved
 * or rejected row requires the owner to return to draft and submit again.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const { id } = await ctx.params;

  let body: { action?: string; reason?: string };
  try {
    body = (await req.json()) as { action?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json(
      {
        error: `Strategy is already ${existing.status}. Ask the owner to resubmit before reviewing again.`,
      },
      { status: 409 }
    );
  }

  const now = new Date();
  const reviewerId = session.user.id;

  if (body.action === "approve") {
    await db
      .update(strategies)
      .set({
        status: "approved",
        rejectionReason: null,
        reviewedBy: reviewerId,
        reviewedAt: now,
      })
      .where(eq(strategies.id, id));

    void queueNotification(existing.creatorId, {
      kind: "strategy_approved",
      text: `✅ <b>${existing.name}</b> was approved. When the listing is active, subscribers can mirror signals; your webhook setup in the studio is unchanged.`,
    });

    void logAdminAudit({
      actorUserId: reviewerId,
      action: "strategy.review.approve",
      targetType: "strategy",
      targetId: id,
      detail: { strategyName: existing.name, creatorId: existing.creatorId },
    });

    revalidatePublicStrategiesList();
    return NextResponse.json({ ok: true, id, status: "approved" });
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, MAX_REASON)
      : null;

  await db
    .update(strategies)
    .set({
      status: "rejected",
      rejectionReason: reason,
      reviewedBy: reviewerId,
      reviewedAt: now,
    })
    .where(eq(strategies.id, id));

  // Rejected strategies must never accept live traffic, so disable the webhook
  // proactively (if one was created).
  await db
    .update(copyWebhookConfig)
    .set({ enabled: false })
    .where(eq(copyWebhookConfig.strategyId, id));

  void queueNotification(existing.creatorId, {
    kind: "strategy_rejected",
    text:
      `❌ <b>${existing.name}</b> was not approved.` +
      (reason ? `\nReason: ${reason}` : "") +
      `\nEdit the listing and resubmit for review from the studio.`,
  });

  void logAdminAudit({
    actorUserId: reviewerId,
    action: "strategy.review.reject",
    targetType: "strategy",
    targetId: id,
    detail: {
      strategyName: existing.name,
      creatorId: existing.creatorId,
      reason,
    },
  });

  revalidatePublicStrategiesList();
  return NextResponse.json({ ok: true, id, status: "rejected", reason });
}
