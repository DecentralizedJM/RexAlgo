import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { getSession, encryptApiSecret } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategies, copyWebhookConfig } from "@/lib/schema";

function newWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: strategyId } = await ctx.params;

  const [strategy] = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.id, strategyId),
        eq(strategies.creatorId, session.user.id),
        eq(strategies.type, "copy_trading")
      )
    );

  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "enable" && action !== "disable" && action !== "rotate") {
    return NextResponse.json(
      { error: "action must be enable, disable, or rotate" },
      { status: 400 }
    );
  }

  const [existing] = await db
    .select()
    .from(copyWebhookConfig)
    .where(eq(copyWebhookConfig.strategyId, strategyId));

  if (action === "disable") {
    if (!existing) {
      return NextResponse.json({ ok: true, enabled: false });
    }
    await db
      .update(copyWebhookConfig)
      .set({ enabled: false })
      .where(eq(copyWebhookConfig.strategyId, strategyId));
    return NextResponse.json({ ok: true, enabled: false });
  }

  // enable or rotate: need a secret
  const plain = newWebhookSecret();
  const secretEncrypted = encryptApiSecret(plain);
  const now = new Date();

  if (!existing) {
    await db.insert(copyWebhookConfig).values({
      strategyId,
      secretEncrypted,
      enabled: action === "enable" || action === "rotate",
      createdAt: now,
      rotatedAt: now,
    });
    return NextResponse.json({
      ok: true,
      enabled: true,
      secretPlain: plain,
      shownOnce: true,
      message: "Store this secret securely; it will not be shown again.",
    });
  }

  if (action === "enable") {
    await db
      .update(copyWebhookConfig)
      .set({ enabled: true })
      .where(eq(copyWebhookConfig.strategyId, strategyId));
    return NextResponse.json({
      ok: true,
      enabled: true,
      secretPlain: null,
      shownOnce: false,
    });
  }

  // rotate
  await db
    .update(copyWebhookConfig)
    .set({
      secretEncrypted,
      enabled: true,
      rotatedAt: now,
    })
    .where(eq(copyWebhookConfig.strategyId, strategyId));

  return NextResponse.json({
    ok: true,
    enabled: true,
    secretPlain: plain,
    shownOnce: true,
    message: "Previous secret is invalid. Update your bot with the new secret.",
  });
}
