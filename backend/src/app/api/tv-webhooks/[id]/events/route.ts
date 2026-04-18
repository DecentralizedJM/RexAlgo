/**
 * GET /api/tv-webhooks/:id/events — last 50 delivery attempts for the caller's webhook.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { tvWebhooks, tvWebhookEvents } from "@/lib/schema";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const [owned] = await db
    .select({ id: tvWebhooks.id })
    .from(tvWebhooks)
    .where(and(eq(tvWebhooks.id, id), eq(tvWebhooks.userId, session.user.id)));
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(tvWebhookEvents)
    .where(eq(tvWebhookEvents.webhookId, id))
    .orderBy(desc(tvWebhookEvents.receivedAt))
    .limit(50);

  return NextResponse.json({
    events: rows.map((r) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(r.payloadJson);
      } catch {
        payload = r.payloadJson;
      }
      return {
        id: r.id,
        idempotencyKey: r.idempotencyKey,
        status: r.status,
        detail: r.detail,
        receivedAt: r.receivedAt.toISOString(),
        clientIp: r.clientIp,
        payload,
      };
    }),
  });
}
