import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { getSession, encryptApiSecret } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies, copyWebhookConfig } from "@/lib/schema";

/**
 * Webhook signing secrets are prefixed with `whsec_` and followed by 32 random bytes
 * (hex-encoded). The prefix is stable so customers can visually distinguish webhook
 * secrets from other tokens in logs.
 */
function newWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("hex")}`;
}

const MAX_NAME = 120;

async function loadOwnedStrategy(strategyId: string, userId: string) {
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.id, strategyId),
        eq(strategies.creatorId, userId),
        eq(strategies.type, "copy_trading")
      )
    );
  return strategy ?? null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  const { id: strategyId } = await ctx.params;

  const strategy = await loadOwnedStrategy(strategyId, session.user.id);
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
      name: strategy.name,
      createdAt: now,
      rotatedAt: now,
    });
    return NextResponse.json({
      ok: true,
      enabled: true,
      name: strategy.name,
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
      name: existing.name ?? strategy.name,
      secretPlain: null,
      shownOnce: false,
    });
  }

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
    name: existing.name ?? strategy.name,
    secretPlain: plain,
    shownOnce: true,
    message: "Previous secret is invalid. Update your bot with the new secret.",
  });
}

/** Rename the webhook (does not affect the signing secret). */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  const { id: strategyId } = await ctx.params;
  const strategy = await loadOwnedStrategy(strategyId, session.user.id);
  if (!strategy) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const trimmed = name.slice(0, MAX_NAME);
  const [existing] = await db
    .select()
    .from(copyWebhookConfig)
    .where(eq(copyWebhookConfig.strategyId, strategyId));
  if (!existing) {
    return NextResponse.json(
      { error: "Enable the webhook first" },
      { status: 404 }
    );
  }

  await db
    .update(copyWebhookConfig)
    .set({ name: trimmed })
    .where(eq(copyWebhookConfig.strategyId, strategyId));

  return NextResponse.json({ ok: true, name: trimmed });
}
