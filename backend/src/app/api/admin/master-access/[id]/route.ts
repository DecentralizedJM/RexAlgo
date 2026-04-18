import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { masterAccessRequests } from "@/lib/schema";
import { queueNotification } from "@/lib/notifications";

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

  return NextResponse.json({ ok: true, id, status: nextStatus });
}
