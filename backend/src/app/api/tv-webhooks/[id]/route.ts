/**
 * PATCH /api/tv-webhooks/:id   — update { name | enabled | mode | strategyId | maxMarginUsdt }
 * DELETE /api/tv-webhooks/:id  — hard delete (cascades to events)
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategies, tvWebhooks } from "@/lib/schema";
import { queueAdminNotification } from "@/lib/adminNotifications";
import { formatAdminUserLine } from "@/lib/adminCopy";

const MAX_NAME = 120;
const MAX_MARGIN_CAP = 10_000;

async function loadOwned(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(tvWebhooks)
    .where(and(eq(tvWebhooks.id, id), eq(tvWebhooks.userId, userId)));
  return row ?? null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await loadOwned(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: {
    name?: string;
    enabled?: boolean;
    mode?: string;
    strategyId?: string | null;
    maxMarginUsdt?: number;
    defaultLeverage?: number;
    defaultRiskPct?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Partial<typeof tvWebhooks.$inferInsert> = {};

  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (!n) {
      return NextResponse.json({ error: "name must be non-empty" }, { status: 400 });
    }
    patch.name = n.slice(0, MAX_NAME);
  }

  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
  }

  if (typeof body.mode === "string") {
    const m = body.mode === "route_to_strategy" ? "route_to_strategy" : "manual_trade";
    patch.mode = m;
    if (m === "manual_trade") {
      patch.strategyId = null;
    }
  }

  const wantsStrategy =
    (patch.mode ?? existing.mode) === "route_to_strategy" &&
    typeof body.strategyId === "string";
  if (wantsStrategy) {
    const sid = body.strategyId as string;
    const [owned] = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(and(eq(strategies.id, sid), eq(strategies.creatorId, session.user.id)));
    if (!owned) {
      return NextResponse.json(
        { error: "Strategy not found or not owned by you" },
        { status: 404 }
      );
    }
    patch.strategyId = sid;
  } else if (body.strategyId === null) {
    patch.strategyId = null;
  }

  if (typeof body.maxMarginUsdt === "number" && Number.isFinite(body.maxMarginUsdt)) {
    const m = Math.abs(body.maxMarginUsdt);
    if (m <= 0) {
      return NextResponse.json(
        { error: "maxMarginUsdt must be > 0" },
        { status: 400 }
      );
    }
    patch.maxMarginUsdt = Math.min(m, MAX_MARGIN_CAP);
  }

  if (
    typeof body.defaultLeverage === "number" &&
    Number.isFinite(body.defaultLeverage)
  ) {
    patch.defaultLeverage = Math.min(100, Math.max(1, Math.round(body.defaultLeverage)));
  }

  if (
    typeof body.defaultRiskPct === "number" &&
    Number.isFinite(body.defaultRiskPct)
  ) {
    patch.defaultRiskPct = Math.min(100, Math.max(0, body.defaultRiskPct));
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  await db.update(tvWebhooks).set(patch).where(eq(tvWebhooks.id, id));
  void queueAdminNotification({
    kind: "admin_tv_webhook_event",
    text:
      `📡 <b>TradingView webhook updated</b>\n\n` +
      `Webhook: <b>${existing.name}</b> · <code>${existing.mode}</code> · <code>${existing.id}</code>\n` +
      `User: ${formatAdminUserLine(session.user)}`,
    meta: { webhookId: existing.id, userId: session.user.id, action: "update", patch },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await loadOwned(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.delete(tvWebhooks).where(eq(tvWebhooks.id, id));
  void queueAdminNotification({
    kind: "admin_tv_webhook_event",
    text:
      `📡 <b>TradingView webhook deleted</b>\n\n` +
      `Webhook: <b>${existing.name}</b> · <code>${existing.mode}</code> · <code>${existing.id}</code>\n` +
      `User: ${formatAdminUserLine(session.user)}`,
    meta: { webhookId: existing.id, userId: session.user.id, action: "delete" },
  });
  return NextResponse.json({ ok: true });
}
