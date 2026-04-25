import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { queueNotification } from "@/lib/notifications";
import { logAdminAudit } from "@/lib/adminAudit";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";

/**
 * Hard-delete a strategy (admin only). Relies on ON DELETE CASCADE FKs for
 * subscriptions, copyWebhookConfig, copySignalEvents, copyMirrorAttempts.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const { id } = await ctx.params;

  const [existing] = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      creatorId: strategies.creatorId,
    })
    .from(strategies)
    .where(eq(strategies.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  await db.delete(strategies).where(eq(strategies.id, id));
  revalidatePublicStrategiesList();

  void queueNotification(existing.creatorId, {
    kind: "strategy_deleted_by_admin",
    text: `🗑 An admin deleted your strategy <b>${existing.name}</b>. All subscriptions and webhooks have been removed.`,
  });

  void logAdminAudit({
    actorUserId: session.user.id,
    action: "strategy.delete",
    targetType: "strategy",
    targetId: id,
    detail: {
      strategyName: existing.name,
      creatorId: existing.creatorId,
    },
  });

  return NextResponse.json({ ok: true, deleted: existing });
}
