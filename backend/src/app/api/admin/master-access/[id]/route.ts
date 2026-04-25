import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { masterAccessRequests } from "@/lib/schema";
import { queueNotification } from "@/lib/notifications";
import { logAdminAudit } from "@/lib/adminAudit";

/**
 * Approve or reject a master-studio access request.
 * Body: `{ action: "approve" | "reject", note?: string }`
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
  let body: { action?: string; note?: string };
  try {
    body = (await req.json()) as { action?: string; note?: string };
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
    .from(masterAccessRequests)
    .where(eq(masterAccessRequests.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json(
      { error: `Request is already ${existing.status}` },
      { status: 409 }
    );
  }

  const nextStatus = body.action === "approve" ? "approved" : "rejected";
  await db
    .update(masterAccessRequests)
    .set({
      status: nextStatus,
      reviewedBy: session.user.email ?? "admin",
      reviewedAt: new Date(),
      note:
        typeof body.note === "string" && body.note.trim().length > 0
          ? body.note.trim().slice(0, 1000)
          : existing.note,
    })
    .where(eq(masterAccessRequests.id, id));

  void queueNotification(existing.userId, {
    kind: nextStatus === "approved" ? "master_access_approved" : "master_access_rejected",
    text:
      nextStatus === "approved"
        ? "✅ <b>Master Studio access approved</b> — you can now publish strategies and copy-trading feeds."
        : "❌ <b>Master Studio access was not approved</b>" +
          (body.note ? `\nNote: ${String(body.note).slice(0, 400)}` : ""),
  });

  void logAdminAudit({
    actorUserId: session.user.id,
    action:
      nextStatus === "approved"
        ? "master_access.review.approve"
        : "master_access.review.reject",
    targetType: "master_access_request",
    targetId: id,
    detail: {
      userId: existing.userId,
      nextStatus,
      note:
        typeof body.note === "string" && body.note.trim().length > 0
          ? body.note.trim().slice(0, 500)
          : undefined,
    },
  });

  return NextResponse.json({ ok: true, id, status: nextStatus });
}

/**
 * Hard-delete a master-access request row (admin only). Removes studio access
 * when the deleted row was `approved`. Pending/rejected rows can be removed for
 * cleanup; the user may submit a new request afterward if no other blockers.
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
    .select()
    .from(masterAccessRequests)
    .where(eq(masterAccessRequests.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  await db.delete(masterAccessRequests).where(eq(masterAccessRequests.id, id));

  void logAdminAudit({
    actorUserId: session.user.id,
    action: "master_access.request.delete",
    targetType: "master_access_request",
    targetId: id,
    detail: {
      userId: existing.userId,
      previousStatus: existing.status,
    },
  });

  if (existing.status === "approved") {
    void queueNotification(existing.userId, {
      kind: "master_access_revoked",
      text:
        "🚫 <b>Master Studio access was removed by an admin</b> — you can no longer open the strategy studios until you are approved again.",
    });
  } else if (existing.status === "pending") {
    void queueNotification(existing.userId, {
      kind: "master_access_rejected",
      text:
        "ℹ️ <b>Your Master Studio request was withdrawn by an admin</b> — you may submit a new request if you still need access.",
    });
  }

  return NextResponse.json({
    ok: true,
    deleted: { id: existing.id, userId: existing.userId, status: existing.status },
  });
}
