/**
 * Per-user strategy slot quotas.
 *
 * A user may hold at most {@link STRATEGY_SLOT_LIMIT} strategies per kind where
 * `status IN ('pending','approved')`. Rejected rows do NOT count against the
 * quota — users are expected to delete or resubmit them to free a slot.
 *
 * This is enforced in code (not in the DB) because we want to surface nice
 * 409 errors with a slot indicator and avoid a race-prone SQL check. Call
 * {@link assertStrategySlotAvailable} before inserting a new row or flipping
 * a rejected row back to `pending` (resubmit).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { strategies, strategySlotExtensionRequests } from "@/lib/schema";

export const STRATEGY_SLOT_LIMIT = 5;

export type StrategyKind = "algo" | "copy_trading";

/**
 * Thrown when the user already holds {@link STRATEGY_SLOT_LIMIT} or more
 * pending/approved strategies of the same kind.
 */
export class StrategySlotLimitError extends Error {
  readonly code = "STRATEGY_SLOT_LIMIT";
  constructor(
    readonly kind: StrategyKind,
    readonly used: number,
    readonly limit: number
  ) {
    super(
      `You already have ${used}/${limit} ${kind === "algo" ? "algo" : "copy-trading"} strategies in pending or approved state. Delete or resubmit a rejected strategy to free a slot.`
    );
  }
}

export async function countStrategySlots(
  userId: string,
  kind: StrategyKind
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(strategies)
    .where(
      and(
        eq(strategies.creatorId, userId),
        eq(strategies.type, kind),
        inArray(strategies.status, ["pending", "approved"] as const)
      )
    );
  return row?.c ?? 0;
}

export async function countApprovedExtraSlots(
  userId: string,
  kind: StrategyKind
): Promise<number> {
  const [row] = await db
    .select({
      c: sql<number>`COALESCE(SUM(${strategySlotExtensionRequests.requestedSlots}), 0)::int`,
    })
    .from(strategySlotExtensionRequests)
    .where(
      and(
        eq(strategySlotExtensionRequests.userId, userId),
        eq(strategySlotExtensionRequests.strategyType, kind),
        eq(strategySlotExtensionRequests.status, "approved")
      )
    );
  return row?.c ?? 0;
}

export async function getStrategySlotLimit(
  userId: string,
  kind: StrategyKind
): Promise<number> {
  return STRATEGY_SLOT_LIMIT + (await countApprovedExtraSlots(userId, kind));
}

export async function assertStrategySlotAvailable(
  userId: string,
  kind: StrategyKind
): Promise<void> {
  const used = await countStrategySlots(userId, kind);
  const limit = await getStrategySlotLimit(userId, kind);
  if (used >= limit) {
    throw new StrategySlotLimitError(kind, used, limit);
  }
}

/** Shape served to the studio UI for its `n/5 slots` indicator. */
export async function getStrategySlotInfo(
  userId: string,
  kind: StrategyKind
): Promise<{ used: number; limit: number }> {
  return {
    used: await countStrategySlots(userId, kind),
    limit: await getStrategySlotLimit(userId, kind),
  };
}
