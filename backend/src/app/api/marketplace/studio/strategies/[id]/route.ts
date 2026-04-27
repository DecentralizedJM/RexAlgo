import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import {
  parseBacktestSpecFromBody,
  serializeBacktestSpec,
} from "@/lib/backtest/spec";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";
import {
  parseAssetSelection,
  serializeSymbols,
  validateMudrexSymbols,
} from "@/lib/strategyAssets";

/**
 * Marketplace (algo) studio per-strategy route.
 *
 * Mirrors the copy-trading edit/delete surface — see that file for the
 * rationale. The marketplace variant additionally accepts a
 * `backtestSpec` JSON object and re-serializes it onto the row.
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
        eq(strategies.type, "algo")
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
  if ("symbol" in body || "symbols" in body || "assetMode" in body) {
    if (!session.apiSecret) {
      return NextResponse.json(
        { error: "Connect your Mudrex API secret before changing strategy symbols." },
        { status: 428 }
      );
    }
    const assetSelection = parseAssetSelection({
      assetMode: body.assetMode ?? existing.assetMode,
      symbol: body.symbol ?? existing.symbol,
      symbols: body.symbols,
    });
    if (!assetSelection.ok) {
      return NextResponse.json({ error: assetSelection.error }, { status: 400 });
    }
    const symbolCheck = await validateMudrexSymbols(session.apiSecret, assetSelection.symbols);
    if (!symbolCheck.ok) {
      return NextResponse.json(
        { error: symbolCheck.error, field: "symbol", invalid: symbolCheck.invalid },
        { status: 400 }
      );
    }
    patch.symbol = assetSelection.primarySymbol;
    patch.assetMode = assetSelection.assetMode;
    patch.symbolsJson = serializeSymbols(assetSelection.symbols);
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

  if (body.backtestSpec !== undefined) {
    const spec = parseBacktestSpecFromBody(body.backtestSpec);
    if (spec) patch.backtestSpecJson = serializeBacktestSpec(spec);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "no editable fields supplied" },
      { status: 400 }
    );
  }

  if (existing.status === "approved") {
    patch.status = "pending";
    patch.rejectionReason = null;
    patch.reviewedBy = null;
    patch.reviewedAt = null;
  }

  await db.update(strategies).set(patch).where(eq(strategies.id, id));
  revalidatePublicStrategiesList();

  const [updated] = await db.select().from(strategies).where(eq(strategies.id, id));
  return NextResponse.json({
    strategy: updated,
    ...(existing.status === "approved"
      ? { notice: "Strategy moved back to pending review after edits." }
      : {}),
  });
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

  await db.delete(strategies).where(eq(strategies.id, id));
  revalidatePublicStrategiesList();

  return NextResponse.json({ ok: true, id });
}
