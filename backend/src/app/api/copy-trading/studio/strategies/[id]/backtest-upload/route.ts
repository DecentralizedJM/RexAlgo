/**
 * Creator-uploaded backtest results for a copy-trading strategy.
 *
 * Mirrors the marketplace upload route — see that file for context.
 *
 * Difference vs marketplace: approved copy-trading listings are locked
 * (subscribers rely on the reviewed parameters), so an upload while
 * `status === "approved"` is rejected with `STRATEGY_LOCKED`. The creator
 * must pause / re-list to publish a new backtest.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNoMasterAccess } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";
import {
  applyBacktestUpload,
  clearBacktestUpload,
} from "@/lib/backtest/applyUpload";

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

  const { id } = await ctx.params;
  const existing = await loadOwned(id, session.user.id);
  if (!existing) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = raw.kind;
  if (kind !== "json" && kind !== "tv_export") {
    return NextResponse.json(
      { error: "kind must be 'json' or 'tv_export'", code: "UPLOAD_KIND_INVALID" },
      { status: 400 }
    );
  }

  const result = await applyBacktestUpload(
    existing.id,
    "copy_trading",
    existing.status,
    {
      kind,
      body: raw.body,
      fileName: typeof raw.fileName === "string" ? raw.fileName : null,
    }
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status }
    );
  }

  revalidatePublicStrategiesList();
  return NextResponse.json({ ok: true, payload: result.payload, meta: result.meta });
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

  await clearBacktestUpload(existing.id);
  revalidatePublicStrategiesList();
  return NextResponse.json({ ok: true });
}
