import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { isAdminUser } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { masterAccessRequests } from "@/lib/schema";

const MAX_NOTE = 1000;

/**
 * Submit a new master-studio access request.
 * Rejects if the user already has a `pending` or `approved` row (409).
 * Admins don't need to request access and get a 200 no-op.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isAdminUser(session.user)) {
    return NextResponse.json({
      ok: true,
      status: "approved",
      message: "Admins have master studio access implicitly.",
    });
  }

  let body: { note?: string } = {};
  try {
    body = (await req.json()) as { note?: string };
  } catch {
    /* body is optional */
  }

  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.trim().slice(0, MAX_NOTE)
      : null;

  const [existingApproved] = await db
    .select({ id: masterAccessRequests.id })
    .from(masterAccessRequests)
    .where(
      and(
        eq(masterAccessRequests.userId, session.user.id),
        eq(masterAccessRequests.status, "approved")
      )
    )
    .limit(1);
  if (existingApproved) {
    return NextResponse.json(
      { error: "You already have master studio access", status: "approved" },
      { status: 409 }
    );
  }

  const [existingPending] = await db
    .select({ id: masterAccessRequests.id })
    .from(masterAccessRequests)
    .where(
      and(
        eq(masterAccessRequests.userId, session.user.id),
        eq(masterAccessRequests.status, "pending")
      )
    )
    .limit(1);
  if (existingPending) {
    return NextResponse.json(
      {
        error: "A request is already pending review",
        status: "pending",
        requestId: existingPending.id,
      },
      { status: 409 }
    );
  }

  const id = uuidv4();
  await db.insert(masterAccessRequests).values({
    id,
    userId: session.user.id,
    status: "pending",
    note,
  });

  return NextResponse.json({ ok: true, status: "pending", requestId: id });
}
