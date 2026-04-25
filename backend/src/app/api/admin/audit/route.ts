import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { adminAuditLog } from "@/lib/schema";

/**
 * Recent admin mutations (newest first, capped at 100 rows).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const rows = await db
    .select()
    .from(adminAuditLog)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(100);

  return NextResponse.json({
    entries: rows.map((r) => {
      let detail: unknown = null;
      if (r.detailJson) {
        try {
          detail = JSON.parse(r.detailJson) as unknown;
        } catch {
          detail = { raw: r.detailJson };
        }
      }
      return {
        id: r.id,
        actorUserId: r.actorUserId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        detail,
        createdAt: r.createdAt.toISOString(),
      };
    }),
  });
}
