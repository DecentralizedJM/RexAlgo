import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategySlotExtensionRequests, users } from "@/lib/schema";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const statusParam = new URL(req.url).searchParams.get("status") ?? "pending";
  const base = db
    .select({
      id: strategySlotExtensionRequests.id,
      userId: strategySlotExtensionRequests.userId,
      strategyType: strategySlotExtensionRequests.strategyType,
      requestedSlots: strategySlotExtensionRequests.requestedSlots,
      status: strategySlotExtensionRequests.status,
      note: strategySlotExtensionRequests.note,
      reviewedBy: strategySlotExtensionRequests.reviewedBy,
      reviewedAt: strategySlotExtensionRequests.reviewedAt,
      createdAt: strategySlotExtensionRequests.createdAt,
      userEmail: users.email,
      userDisplayName: users.displayName,
    })
    .from(strategySlotExtensionRequests)
    .leftJoin(users, eq(users.id, strategySlotExtensionRequests.userId))
    .orderBy(desc(strategySlotExtensionRequests.createdAt));

  const rows =
    statusParam === "all"
      ? await base
      : await base.where(
          inArray(
            strategySlotExtensionRequests.status,
            statusParam
              .split(",")
              .map((s) => s.trim())
              .filter(
                (s): s is "pending" | "approved" | "rejected" =>
                  s === "pending" || s === "approved" || s === "rejected"
              )
          )
        );

  return NextResponse.json({
    requests: rows.map((r) => ({
      ...r,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
