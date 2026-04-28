import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies, copyWebhookConfig } from "@/lib/schema";
import { queueNotification } from "@/lib/notifications";
import { queueAdminNotification } from "@/lib/adminNotifications";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";

/**
 * POST /api/copy-trading/studio/strategies/[id]/submit-review
 *
 * Same gates as the marketplace variant, for `copy_trading` rows.
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

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.id, id),
        eq(strategies.creatorId, session.user.id),
        eq(strategies.type, "copy_trading")
      )
    );
  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }
  if (strategy.status !== "draft") {
    return NextResponse.json(
      {
        error:
          strategy.status === "pending"
            ? "This strategy is already awaiting admin review."
            : strategy.status === "approved"
              ? "Approved listings are not submitted again from here."
              : "Only draft listings can be submitted for review. Resubmit from the studio if this strategy was rejected.",
        code: "STRATEGY_NOT_DRAFT",
        status: strategy.status,
      },
      { status: 409 }
    );
  }

  const [wh] = await db
    .select()
    .from(copyWebhookConfig)
    .where(eq(copyWebhookConfig.strategyId, id));

  if (!wh?.enabled || !wh.lastDeliveryAt) {
    return NextResponse.json(
      {
        error:
          "Enable the webhook and send at least one test signal (so we record a delivery) before submitting for review.",
        code: "WEBHOOK_NOT_VERIFIED",
      },
      { status: 409 }
    );
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

  void queueNotification(strategy.creatorId, {
    kind: "strategy_submitted_for_review",
    text: `📋 <b>${strategy.name}</b> (copy-trading) was submitted for admin review. You will be notified when it is approved or rejected.`,
    meta: { strategyId: id, type: "copy_trading" as const },
  });

  void queueAdminNotification({
    kind: "admin_strategy_submitted_for_review",
    text:
      `📥 <b>New strategy review request</b>\n` +
      `Name: <b>${strategy.name}</b>\n` +
      `Type: <code>copy_trading</code>\n` +
      `Strategy ID: <code>${id}</code>\n` +
      `Creator ID: <code>${strategy.creatorId}</code>`,
    telegram: {
      replyMarkup: {
        inline_keyboard: [[{ text: "Approve in Telegram", callback_data: `adm:strategy:approve:${id}` }]],
      },
    },
    meta: { strategyId: id, type: "copy_trading", creatorId: strategy.creatorId },
  });

  const [updated] = await db.select().from(strategies).where(eq(strategies.id, id));
  return NextResponse.json({ ok: true, strategy: updated });
}
