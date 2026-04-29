import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { desc, eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies, copyWebhookConfig } from "@/lib/schema";
import { publicApiBase } from "@/lib/publicUrl";
import { strategySignalWebhookPath } from "@/lib/strategyWebhookPath";
import { withBacktestUpload } from "@/lib/backtest/uploadSerialize";
import {
  StrategySlotLimitError,
  assertStrategySlotAvailable,
  countStrategySlots,
  getStrategySlotLimit,
} from "@/lib/quotas";
import { validateStrategyDescription } from "@/lib/strategyValidation";
import { queueAdminNotification } from "@/lib/adminNotifications";
import { formatAdminStrategyLine, formatAdminUserLine } from "@/lib/adminCopy";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  const rows = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.creatorId, session.user.id),
        eq(strategies.type, "copy_trading")
      )
    )
    .orderBy(desc(strategies.createdAt));

  const allWh = await db.select().from(copyWebhookConfig);
  const whMap = new Map(allWh.map((w) => [w.strategyId, w]));

  const base = publicApiBase();

  const out = rows.map((s) => {
    const w = whMap.get(s.id);
    const path = strategySignalWebhookPath(s.id);
    return withBacktestUpload({
      ...s,
      // See marketplace twin: `webhookConfigured` is the existence of the
      // `copy_webhook_config` row, regardless of `enabled`. Lets the studio
      // hide the URL/regenerate/disable controls until the creator has
      // explicitly clicked "Create webhook URL" (Workstream B UX).
      webhookConfigured: Boolean(w),
      webhookEnabled: w?.enabled ?? false,
      webhookName: w?.name ?? s.name,
      webhookLastDeliveryAt: w?.lastDeliveryAt?.toISOString() ?? null,
      webhookRotatedAt: w?.rotatedAt?.toISOString() ?? null,
      webhookUrl: base ? `${base}${path}` : null,
      webhookPath: path,
    });
  });

  const used = await countStrategySlots(session.user.id, "copy_trading");
  const limit = await getStrategySlotLimit(session.user.id, "copy_trading");

  return NextResponse.json({
    strategies: out,
    publicBaseUrl: base || null,
    slots: { used, limit },
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  try {
    try {
      await assertStrategySlotAvailable(session.user.id, "copy_trading");
    } catch (err) {
      if (err instanceof StrategySlotLimitError) {
        return NextResponse.json(
          {
            error: err.message,
            code: err.code,
            used: err.used,
            limit: err.limit,
          },
          { status: 409 }
        );
      }
      throw err;
    }

    const body = await req.json();
    const descriptionCheck = validateStrategyDescription(body.description);
    if (!descriptionCheck.ok) {
      return NextResponse.json(
        { error: descriptionCheck.message, code: "DESCRIPTION_TOO_SHORT" },
        { status: 400 }
      );
    }

    const id = uuidv4();
    const newStrategy = {
      id,
      creatorId: session.user.id,
      creatorName: session.user.displayName,
      name: body.name,
      description: descriptionCheck.value,
      type: "copy_trading" as const,
      symbol: body.symbol,
      side: body.side as "LONG" | "SHORT" | "BOTH",
      leverage: body.leverage || "1",
      stoplossPct: body.stoplossPct ? parseFloat(body.stoplossPct) : null,
      takeprofitPct: body.takeprofitPct ? parseFloat(body.takeprofitPct) : null,
      riskLevel: (body.riskLevel || "medium") as "low" | "medium" | "high",
      timeframe: body.timeframe || "1h",
      isActive: true,
      // New listings start in draft: owner enables webhook, sends a test signal, then submits for review.
      status: "draft" as const,
      totalPnl: 0,
      winRate: 0,
      totalTrades: 0,
      subscriberCount: 0,
    };

    if (!newStrategy.name || !newStrategy.symbol) {
      return NextResponse.json(
        { error: "name and symbol are required" },
        { status: 400 }
      );
    }

    await db.insert(strategies).values(newStrategy);

    const [created] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    void queueAdminNotification({
      kind: "admin_strategy_draft_created",
      text:
        `📝 <b>New strategy draft created</b>\n\n` +
        `Strategy: ${formatAdminStrategyLine({ id, name: newStrategy.name, type: "copy_trading", symbol: newStrategy.symbol })}\n` +
        `Creator: ${formatAdminUserLine(session.user)}\n\n` +
        `Status: <code>draft</code>`,
      meta: { strategyId: id, type: "copy_trading", creatorId: session.user.id, status: "draft" },
    });

    const base = publicApiBase();
    const path = strategySignalWebhookPath(id);

    return NextResponse.json(
      {
        strategy: {
          ...created,
          webhookEnabled: false,
          webhookName: created.name,
          webhookLastDeliveryAt: null,
          webhookRotatedAt: null,
          webhookUrl: base ? `${base}${path}` : null,
          webhookPath: path,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Studio strategy create error:", error);
    return NextResponse.json({ error: "Failed to create strategy" }, { status: 500 });
  }
}
