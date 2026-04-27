import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { and, desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategySlotExtensionRequests } from "@/lib/schema";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  const rows = await db
    .select()
    .from(strategySlotExtensionRequests)
    .where(
      and(
        eq(strategySlotExtensionRequests.userId, session.user.id),
        eq(strategySlotExtensionRequests.strategyType, "algo")
      )
    )
    .orderBy(desc(strategySlotExtensionRequests.createdAt));

  return NextResponse.json({
    requests: rows.map((r) => ({
      ...r,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  let body: { requestedSlots?: unknown; note?: unknown };
  try {
    body = (await req.json()) as { requestedSlots?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pending = await db
    .select({ id: strategySlotExtensionRequests.id })
    .from(strategySlotExtensionRequests)
    .where(
      and(
        eq(strategySlotExtensionRequests.userId, session.user.id),
        eq(strategySlotExtensionRequests.strategyType, "algo"),
        eq(strategySlotExtensionRequests.status, "pending")
      )
    );
  if (pending.length > 0) {
    return NextResponse.json(
      { error: "You already have a pending slot request." },
      { status: 409 }
    );
  }

  const requestedSlots = Math.min(
    20,
    Math.max(1, Math.floor(Number(body.requestedSlots) || 1))
  );
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 1000)
      : null;
  const id = uuidv4();

  await db.insert(strategySlotExtensionRequests).values({
    id,
    userId: session.user.id,
    strategyType: "algo",
    requestedSlots,
    note,
  });

  return NextResponse.json(
    {
      request: {
        id,
        userId: session.user.id,
        strategyType: "algo",
        requestedSlots,
        status: "pending",
        note,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: new Date().toISOString(),
      },
    },
    { status: 201 }
  );
}
