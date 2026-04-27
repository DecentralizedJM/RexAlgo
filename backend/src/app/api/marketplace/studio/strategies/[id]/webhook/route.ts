import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { getSession, encryptApiSecret, requireRecentSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies, copyWebhookConfig } from "@/lib/schema";

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
        eq(strategies.type, "algo")
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
  const recentBlock = requireRecentSession(session);
  if (recentBlock) return recentBlock;

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

  // Owners may always disable. Enabling or rotating a webhook is only
  // permitted for approved listings so we don't accept live traffic for a
  // strategy an admin has not yet reviewed.
  if (
    (action === "enable" || action === "rotate") &&
    strategy.status !== "approved"
  ) {
    return NextResponse.json(
      {
        error:
          strategy.status === "pending"
            ? "This strategy is awaiting admin review — webhook can only be enabled after approval."
            : "This strategy was rejected — edit and reapply before enabling the webhook.",
        code: "STRATEGY_NOT_APPROVED",
        status: strategy.status,
      },
      { status: 409 }
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
