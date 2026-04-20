import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { getMasterAccessStatus, isAdminUser } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { masterAccessRequests } from "@/lib/schema";

/**
 * Returns the current user's master-studio access state and (optionally) their
 * latest request so the UI can show "waiting for review since..." etc.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getMasterAccessStatus(session.user);
  const isAdmin = isAdminUser(session.user);

  const [latest] = await db
    .select()
    .from(masterAccessRequests)
    .where(eq(masterAccessRequests.userId, session.user.id))
    .orderBy(desc(masterAccessRequests.createdAt))
    .limit(1);

  return NextResponse.json({
    status,
    isAdmin,
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          note: latest.note,
          contactPhone: latest.contactPhone ?? "",
          reviewedBy: latest.reviewedBy,
          reviewedAt: latest.reviewedAt?.toISOString() ?? null,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
  });
}
