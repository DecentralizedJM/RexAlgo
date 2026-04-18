import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { masterAccessRequests, users, strategies } from "@/lib/schema";

/**
 * List master-studio access requests (admin only).
 * Filter with `?status=pending|approved|rejected|all` (default: pending).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "pending";

  const base = db
    .select({
      id: masterAccessRequests.id,
      userId: masterAccessRequests.userId,
      status: masterAccessRequests.status,
      note: masterAccessRequests.note,
      reviewedBy: masterAccessRequests.reviewedBy,
      reviewedAt: masterAccessRequests.reviewedAt,
      createdAt: masterAccessRequests.createdAt,
      userEmail: users.email,
      userDisplayName: users.displayName,
      userStrategyCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${strategies} WHERE ${strategies.creatorId} = ${masterAccessRequests.userId}
      )`,
    })
    .from(masterAccessRequests)
    .leftJoin(users, eq(users.id, masterAccessRequests.userId))
    .orderBy(desc(masterAccessRequests.createdAt));

  const rows =
    statusParam === "all"
      ? await base
      : await base.where(
          inArray(
            masterAccessRequests.status,
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
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      userDisplayName: r.userDisplayName,
      userStrategyCount: r.userStrategyCount,
      status: r.status,
      note: r.note,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
