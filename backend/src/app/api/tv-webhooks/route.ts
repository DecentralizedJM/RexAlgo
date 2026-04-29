/**
 * User-owned TradingView webhooks (Phase 5).
 *
 * GET  /api/tv-webhooks         — list the caller's webhooks (never returns secrets).
 * POST /api/tv-webhooks         — create a new webhook; response includes the
 *                                  one-time plain secret.
 *
 * All rows are scoped to `session.user.id`. Listing a strategy in
 * `route_to_strategy` mode additionally checks that the strategy is owned by the
 * caller.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { and, desc, eq } from "drizzle-orm";
import { getSession, encryptApiSecret } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategies, tvWebhooks } from "@/lib/schema";
import { publicApiBase } from "@/lib/publicUrl";
import { queueAdminNotification } from "@/lib/adminNotifications";
import { formatAdminUserLine } from "@/lib/adminCopy";

const MAX_NAME = 120;
const MAX_MARGIN_CAP = 10_000;

function newWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("hex")}`;
}

/** Never include secrets on read; expose only safe metadata. */
function toRow(
  w: typeof tvWebhooks.$inferSelect,
  base: string
): Record<string, unknown> {
  const path = `/api/webhooks/tv/${w.id}`;
  return {
    id: w.id,
    name: w.name,
    enabled: w.enabled,
    mode: w.mode,
    strategyId: w.strategyId,
    maxMarginUsdt: w.maxMarginUsdt,
    defaultLeverage: w.defaultLeverage ?? 5,
    defaultRiskPct: w.defaultRiskPct ?? 2,
    createdAt: w.createdAt.toISOString(),
    rotatedAt: w.rotatedAt?.toISOString() ?? null,
    lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
    webhookUrl: base ? `${base}${path}` : null,
    webhookPath: path,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(tvWebhooks)
    .where(eq(tvWebhooks.userId, session.user.id))
    .orderBy(desc(tvWebhooks.createdAt));

  const base = publicApiBase();
  return NextResponse.json({
    webhooks: rows.map((r) => toRow(r, base)),
    publicBaseUrl: base || null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    name?: string;
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: "name is too long" }, { status: 400 });
  }

  const mode =
    body.mode === "route_to_strategy" ? "route_to_strategy" : "manual_trade";

  let strategyId: string | null = null;
  if (mode === "route_to_strategy") {
    const sid = typeof body.strategyId === "string" ? body.strategyId : "";
    if (!sid) {
      return NextResponse.json(
        { error: "strategyId is required for route_to_strategy mode" },
        { status: 400 }
      );
    }
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
    strategyId = sid;
  }

  let maxMarginUsdt = 50;
  if (typeof body.maxMarginUsdt === "number" && Number.isFinite(body.maxMarginUsdt)) {
    const m = Math.abs(body.maxMarginUsdt);
    if (m <= 0) {
      return NextResponse.json(
        { error: "maxMarginUsdt must be > 0" },
        { status: 400 }
      );
    }
    maxMarginUsdt = Math.min(m, MAX_MARGIN_CAP);
  }

  let defaultLeverage = 5;
  if (
    typeof body.defaultLeverage === "number" &&
    Number.isFinite(body.defaultLeverage)
  ) {
    defaultLeverage = Math.min(100, Math.max(1, Math.round(body.defaultLeverage)));
  }

  let defaultRiskPct = 2;
  if (
    typeof body.defaultRiskPct === "number" &&
    Number.isFinite(body.defaultRiskPct)
  ) {
    defaultRiskPct = Math.min(100, Math.max(0, body.defaultRiskPct));
  }

  const plain = newWebhookSecret();
  const id = uuidv4();

  await db.insert(tvWebhooks).values({
    id,
    userId: session.user.id,
    name: name.slice(0, MAX_NAME),
    secretEncrypted: encryptApiSecret(plain),
    enabled: true,
    mode,
    strategyId,
    maxMarginUsdt,
    defaultLeverage,
    defaultRiskPct,
  });

  const [created] = await db
    .select()
    .from(tvWebhooks)
    .where(eq(tvWebhooks.id, id));

  void queueAdminNotification({
    kind: "admin_tv_webhook_event",
    text:
      `📡 <b>TradingView webhook created</b>\n\n` +
      `Webhook: <b>${created.name}</b> · <code>${created.mode}</code> · <code>${created.id}</code>\n` +
      `User: ${formatAdminUserLine(session.user)}`,
    meta: { webhookId: created.id, mode: created.mode, userId: session.user.id, action: "create" },
  });

  const base = publicApiBase();
  return NextResponse.json(
    {
      webhook: toRow(created, base),
      secretPlain: plain,
      shownOnce: true,
      message: "Store this secret securely; it will not be shown again.",
    },
    { status: 201 }
  );
}
