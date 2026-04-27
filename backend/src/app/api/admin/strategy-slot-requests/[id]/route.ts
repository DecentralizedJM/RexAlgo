import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategySlotExtensionRequests } from "@/lib/schema";
import { logAdminAudit } from "@/lib/adminAudit";
import { queueNotification } from "@/lib/notifications";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const { id } = await ctx.params;
  let body: { action?: string; note?: string };
  try {
    body = (await req.json()) as { action?: string; note?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(strategySlotExtensionRequests)
    .where(eq(strategySlotExtensionRequests.id, id));
  if (!existing) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (existing.status !== "pending") {
    return NextResponse.json({ error: `Request is already ${existing.status}` }, { status: 409 });
  }

  const nextStatus = body.action === "approve" ? "approved" : "rejected";
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 1000)
      : existing.note;
  await db
    .update(strategySlotExtensionRequests)
    .set({
      status: nextStatus,
      note,
      reviewedBy: session.user.email ?? session.user.id,
      reviewedAt: new Date(),
    })
    .where(eq(strategySlotExtensionRequests.id, id));

  void logAdminAudit({
    actorUserId: session.user.id,
    action:
      nextStatus === "approved"
        ? "strategy_slots.review.approve"
        : "strategy_slots.review.reject",
    targetType: "strategy_slot_extension_request",
    targetId: id,
    detail: {
      userId: existing.userId,
      strategyType: existing.strategyType,
      requestedSlots: existing.requestedSlots,
      nextStatus,
    },
  });

  void queueNotification(existing.userId, {
    kind: nextStatus === "approved" ? "strategy_slots_approved" : "strategy_slots_rejected",
    text:
      nextStatus === "approved"
        ? `✅ <b>Extra strategy slots approved</b> — ${existing.requestedSlots} additional ${existing.strategyType} slot(s) are now available.`
        : "❌ <b>Extra strategy slots request rejected</b>" +
          (note ? `\nNote: ${note.slice(0, 400)}` : ""),
  });

  return NextResponse.json({ ok: true, id, status: nextStatus });
}
