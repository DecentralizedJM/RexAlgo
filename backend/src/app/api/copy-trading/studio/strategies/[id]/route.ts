import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";

/**
 * Copy-trading studio per-strategy route.
 *
 * Supports edit (PATCH) and delete (DELETE) of a user's own copy-trading
 * listing. Editing is only permitted while the listing is `pending` or
 * `rejected` — approved listings are locked to prevent silent drift of the
 * parameters subscribers signed up for. Deleting is only permitted for
 * non-approved listings for the same reason. Moving a `rejected` listing
 * back to `pending` is handled by POST `./resubmit/route.ts`.
 */

const SIDES = ["LONG", "SHORT", "BOTH"] as const;
type Side = (typeof SIDES)[number];
const RISK_LEVELS = ["low", "medium", "high"] as const;
type RiskLevel = (typeof RISK_LEVELS)[number];

function parseOptionalPct(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function loadOwned(strategyId: string, userId: string) {
  const [row] = await db
    .select()
    .from(strategies)
    .where(
      and(
        eq(strategies.id, strategyId),
        eq(strategies.creatorId, userId),
        eq(strategies.type, "copy_trading")
      )
    );
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
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const existing = await loadOwned(id, session.user.id);
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  // Approved listings are locked — subscribers rely on the reviewed parameters.
  if (existing.status === "approved") {
    return NextResponse.json(
      {
        error:
          "Approved listings cannot be edited. Pause and resubmit a fresh version if you need to change parameters.",
        code: "STRATEGY_LOCKED",
        status: existing.status,
      },
      { status: 409 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Partial<typeof strategies.$inferInsert> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    patch.name = name;
  }
  if (typeof body.description === "string") {
    const description = body.description.trim();
    if (!description) {
      return NextResponse.json(
        { error: "description cannot be empty" },
        { status: 400 }
      );
    }
    patch.description = description;
  }
  if (typeof body.symbol === "string") {
    const symbol = body.symbol.trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: "symbol cannot be empty" }, { status: 400 });
    }
    patch.symbol = symbol;
  }
  if (typeof body.side === "string") {
    const side = body.side.toUpperCase() as Side;
    if (!SIDES.includes(side)) {
      return NextResponse.json({ error: "invalid side" }, { status: 400 });
    }
    patch.side = side;
  }
  if (typeof body.leverage === "string" || typeof body.leverage === "number") {
    patch.leverage = String(body.leverage);
  }
  if (typeof body.riskLevel === "string") {
    const r = body.riskLevel as RiskLevel;
    if (!RISK_LEVELS.includes(r)) {
      return NextResponse.json({ error: "invalid riskLevel" }, { status: 400 });
    }
    patch.riskLevel = r;
  }
  if (typeof body.timeframe === "string") {
    patch.timeframe = body.timeframe.trim() || "1h";
  }
  const sl = parseOptionalPct(body.stoplossPct);
  if (sl !== undefined) patch.stoplossPct = sl;
  const tp = parseOptionalPct(body.takeprofitPct);
  if (tp !== undefined) patch.takeprofitPct = tp;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "no editable fields supplied" },
      { status: 400 }
    );
  }

  await db.update(strategies).set(patch).where(eq(strategies.id, id));

  const [updated] = await db.select().from(strategies).where(eq(strategies.id, id));
  return NextResponse.json({ strategy: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const blocked = await blockIfNoMasterAccess(session.user);
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const existing = await loadOwned(id, session.user.id);
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  if (existing.status === "approved") {
    return NextResponse.json(
      {
        error:
          "Approved listings cannot be deleted from the studio. Contact an admin if the strategy needs to be retired.",
        code: "STRATEGY_LOCKED",
      },
      { status: 409 }
    );
  }

  // FK cascades handle copy_webhook_config + copy_strategy_signals +
  // subscriptions. trade_logs.strategyId is ON DELETE SET NULL so historical
  // volume stays on the ledger.
  await db.delete(strategies).where(eq(strategies.id, id));

  return NextResponse.json({ ok: true, id });
}
