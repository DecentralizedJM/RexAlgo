import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { users, strategies, masterAccessRequests } from "@/lib/schema";

/**
 * Read-only user directory (admin only). Includes master-access status and strategy count.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      authProvider: users.authProvider,
      createdAt: users.createdAt,
      strategyCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${strategies} WHERE ${strategies.creatorId} = ${users.id}
      )`,
      masterStatus: sql<string | null>`(
        SELECT ${masterAccessRequests.status}
        FROM ${masterAccessRequests}
        WHERE ${masterAccessRequests.userId} = ${users.id}
        ORDER BY
          CASE ${masterAccessRequests.status}
            WHEN 'approved' THEN 0
            WHEN 'pending' THEN 1
            ELSE 2
          END,
          ${masterAccessRequests.createdAt} DESC
        LIMIT 1
      )`,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return NextResponse.json({
    users: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
