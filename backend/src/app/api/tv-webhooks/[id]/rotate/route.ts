/**
 * POST /api/tv-webhooks/:id/rotate — issues a new signing secret (shown once).
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { encryptApiSecret, getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { tvWebhooks } from "@/lib/schema";

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

  return NextResponse.json({
    ok: true,
    secretPlain: plain,
    shownOnce: true,
    message: "Previous secret is invalid. Update your TradingView alert with the new secret.",
  });
}
