import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { logAdminAudit } from "@/lib/adminAudit";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";

/**
 * Flip `strategies.is_active` (admin only). Optional body `{ active: boolean }`
 * sets a specific value; omitting it toggles.
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

  const [existing] = await db
    .select({ id: strategies.id, isActive: strategies.isActive })
    .from(strategies)
    .where(eq(strategies.id, id));
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  let body: { active?: boolean } = {};
  try {
    body = (await req.json()) as { active?: boolean };
  } catch {
    /* no body is fine */
  }

  const nextActive =
    typeof body.active === "boolean" ? body.active : !existing.isActive;

  await db
    .update(strategies)
    .set({ isActive: nextActive })
    .where(eq(strategies.id, id));

  void logAdminAudit({
    actorUserId: session.user.id,
    action: "strategy.toggle_active",
    targetType: "strategy",
    targetId: id,
    detail: { isActive: nextActive, previousActive: existing.isActive },
  });

  revalidatePublicStrategiesList();
  return NextResponse.json({ ok: true, id, isActive: nextActive });
}
