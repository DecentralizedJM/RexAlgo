import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdminUser } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { strategies, copyWebhookConfig } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  parseBacktestSpecFromBody,
  serializeBacktestSpec,
} from "@/lib/backtest/spec";
import { withBacktestUpload } from "@/lib/backtest/uploadSerialize";
import { validateStrategyPatch } from "@/lib/strategyValidation";
import { queueNotification } from "@/lib/notifications";
import { revalidatePublicStrategiesList } from "@/lib/publicStrategiesCache";

/**
 * Fields that materially change what a strategy will *do* to subscribers.
 * Editing any of them on an approved strategy bumps it back to `draft`
 * so the owner re-verifies the webhook and the admin can re-audit before users keep copying the old version of
 * the strategy (audit #16).
 *
 * Non-sensitive fields (`name`, `description`, `riskLevel`, `isActive`,
 * `timeframe`, sl/tp) still update in place without re-review.
 */
const SENSITIVE_EDIT_FIELDS = [
  "symbol",
  "side",
  "leverage",
  "backtestSpec",
] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    // Gate draft / pending / rejected / deactivated strategies so enumerating UUIDs
    // can't surface hidden rows or rejection reasons. Creators always see their
    // own row; admins see everything. Return 404 (not 403) to avoid
    // confirming that a hidden strategy exists.
    const isPublic = strategy.status === "approved" && strategy.isActive;
    if (!isPublic) {
      const session = await getSession();
      const isCreator = session?.user.id === strategy.creatorId;
      const isAdmin = isAdminUser(session?.user ?? null);
      if (!isCreator && !isAdmin) {
        return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
      }
    }

    return NextResponse.json({ strategy: withBacktestUpload(strategy) });
  } catch (error) {
    console.error("Strategy fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch strategy" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const [existing] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!existing) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    if (existing.creatorId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (
      rawBody &&
      typeof rawBody === "object" &&
      !Array.isArray(rawBody) &&
      ("type" in rawBody || "creatorId" in rawBody || "creator_id" in rawBody)
    ) {
      return NextResponse.json(
        { error: "Cannot change type or creator" },
        { status: 400 }
      );
    }

    const validation = validateStrategyPatch(rawBody);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: "Invalid strategy input",
          code: "VALIDATION_FAILED",
          details: validation.errors,
        },
        { status: 400 }
      );
    }

    const patch: Partial<typeof strategies.$inferInsert> = {};
    const v = validation.patch;
    if (v.name !== undefined) patch.name = v.name;
    if (v.description !== undefined) patch.description = v.description;
    if (v.symbol !== undefined) patch.symbol = v.symbol;
    if (v.side !== undefined) patch.side = v.side;
    if (v.leverage !== undefined) patch.leverage = v.leverage;
    if (v.stoplossPct !== undefined) patch.stoplossPct = v.stoplossPct;
    if (v.takeprofitPct !== undefined) patch.takeprofitPct = v.takeprofitPct;
    if (v.riskLevel !== undefined) patch.riskLevel = v.riskLevel;
    if (v.timeframe !== undefined) patch.timeframe = v.timeframe;
    if (v.isActive !== undefined) patch.isActive = v.isActive;

    if (v.backtestSpec !== undefined) {
      if (existing.type !== "algo") {
        return NextResponse.json(
          { error: "backtestSpec only applies to algo strategies" },
          { status: 400 }
        );
      }
      if (v.backtestSpec === null) {
        patch.backtestSpecJson = null;
      } else {
        const spec = parseBacktestSpecFromBody(v.backtestSpec);
        if (!spec) {
          return NextResponse.json(
            { error: "Invalid backtestSpec (engine and params)" },
            { status: 400 }
          );
        }
        patch.backtestSpecJson = serializeBacktestSpec(spec);
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Audit #16: if an approved strategy edits a sensitive field, reset it
    // to `pending` and notify the creator. This keeps the approval gate
    // meaningful — an admin can't sign off on strategy X and then have the
    // creator silently flip it to a leveraged short on a different symbol.
    const patchedSensitive = SENSITIVE_EDIT_FIELDS.some(
      (f) => v[f] !== undefined
    );
    const requeueForReview =
      patchedSensitive && existing.status === "approved";
    if (requeueForReview) {
      patch.status = "draft";
      patch.rejectionReason = null;
      patch.reviewedAt = null;
      patch.reviewedBy = null;
    }

    await db.update(strategies).set(patch).where(eq(strategies.id, id));
    if (requeueForReview) {
      await db
        .update(copyWebhookConfig)
        .set({ enabled: false })
        .where(eq(copyWebhookConfig.strategyId, id));
    }
    revalidatePublicStrategiesList();

    const [updated] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (requeueForReview) {
      // Fire-and-forget; notification failures must not abort the PATCH.
      void queueNotification(existing.creatorId, {
        kind: "strategy_requeued_for_review",
        text:
          `Your strategy "${existing.name}" returned to setup (draft) because ` +
          `you changed its symbol, side, leverage or backtest spec. The webhook was disabled — send a test signal, then submit for admin review. It stays hidden from the marketplace until re-approved.`,
        meta: {
          strategyId: id,
          changedFields: SENSITIVE_EDIT_FIELDS.filter(
            (f) => v[f] !== undefined
          ),
        },
      });
    }

    return NextResponse.json({
      strategy: updated,
      ...(requeueForReview
        ? {
            notice:
              "Strategy returned to setup (draft): webhook disabled. Verify with a test signal, then submit for admin review.",
          }
        : {}),
    });
  } catch (error) {
    console.error("Strategy patch error:", error);
    return NextResponse.json({ error: "Failed to update strategy" }, { status: 500 });
  }
}
