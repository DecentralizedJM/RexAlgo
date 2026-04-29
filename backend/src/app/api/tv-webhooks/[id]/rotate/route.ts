/**
 * POST /api/tv-webhooks/:id/rotate — issues a new signing secret (shown once).
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { encryptApiSecret, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { tvWebhooks } from "@/lib/schema";
import { queueAdminNotification } from "@/lib/adminNotifications";
import { formatAdminUserLine } from "@/lib/adminCopy";

function newWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("hex")}`;
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const [existing] = await db
    .select()
    .from(tvWebhooks)
    .where(and(eq(tvWebhooks.id, id), eq(tvWebhooks.userId, session.user.id)));
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const plain = newWebhookSecret();
  await db
    .update(tvWebhooks)
    .set({
      secretEncrypted: encryptApiSecret(plain),
      rotatedAt: new Date(),
      enabled: true,
    })
    .where(eq(tvWebhooks.id, id));

  void queueAdminNotification({
    kind: "admin_tv_webhook_event",
    text:
      `📡 <b>TradingView webhook secret rotated</b>\n\n` +
      `Webhook: <b>${existing.name}</b> · <code>${existing.mode}</code> · <code>${existing.id}</code>\n` +
      `User: ${formatAdminUserLine(session.user)}`,
    meta: { webhookId: existing.id, userId: session.user.id, action: "rotate" },
  });

  return NextResponse.json({
    ok: true,
    secretPlain: plain,
    shownOnce: true,
    message: "Previous secret is invalid. Update your TradingView alert with the new secret.",
  });
}
