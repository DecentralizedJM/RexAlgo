import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import {
  users,
  strategies,
  subscriptions,
  tvWebhooks,
  tradeLogs,
  masterAccessRequests,
} from "@/lib/schema";

/**
 * Admin drill-down for a single user.
 *
 * Returns everything the dashboard drawer needs to understand what this user
 * is doing on the platform in one round trip:
 *   - identity + telegram + master-access history
 *   - strategies they've created (with per-strategy status)
 *   - strategies they're subscribed to
 *   - TradingView webhooks they own
 *   - recent trade-log ledger entries + per-source volume totals
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const { id } = await ctx.params;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      authProvider: users.authProvider,
      createdAt: users.createdAt,
      hasMudrexKey: sql<boolean>`(${users.apiSecretEncrypted} IS NOT NULL)`,
      telegramLinked: sql<boolean>`(${users.telegramId} IS NOT NULL)`,
      telegramUsername: users.telegramUsername,
      telegramNotifyEnabled: users.telegramNotifyEnabled,
    })
    .from(users)
    .where(eq(users.id, id));

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const createdStrategies = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      type: strategies.type,
      symbol: strategies.symbol,
      isActive: strategies.isActive,
      status: strategies.status,
      rejectionReason: strategies.rejectionReason,
      subscriberCount: strategies.subscriberCount,
      createdAt: strategies.createdAt,
    })
    .from(strategies)
    .where(eq(strategies.creatorId, id))
    .orderBy(desc(strategies.createdAt));

  const userSubs = await db
    .select({
      id: subscriptions.id,
      strategyId: subscriptions.strategyId,
      marginPerTrade: subscriptions.marginPerTrade,
      isActive: subscriptions.isActive,
      createdAt: subscriptions.createdAt,
      strategyName: strategies.name,
      strategyType: strategies.type,
      strategyStatus: strategies.status,
      strategySymbol: strategies.symbol,
      creatorId: strategies.creatorId,
    })
    .from(subscriptions)
    .leftJoin(strategies, eq(subscriptions.strategyId, strategies.id))
    .where(eq(subscriptions.userId, id))
    .orderBy(desc(subscriptions.createdAt));

  const userTvWebhooks = await db
    .select({
      id: tvWebhooks.id,
      name: tvWebhooks.name,
      enabled: tvWebhooks.enabled,
      mode: tvWebhooks.mode,
      strategyId: tvWebhooks.strategyId,
      maxMarginUsdt: tvWebhooks.maxMarginUsdt,
      lastDeliveryAt: tvWebhooks.lastDeliveryAt,
      createdAt: tvWebhooks.createdAt,
    })
    .from(tvWebhooks)
    .where(eq(tvWebhooks.userId, id))
    .orderBy(desc(tvWebhooks.createdAt));

  const recentTrades = await db
    .select({
      id: tradeLogs.id,
      symbol: tradeLogs.symbol,
      side: tradeLogs.side,
      quantity: tradeLogs.quantity,
      entryPrice: tradeLogs.entryPrice,
      source: tradeLogs.source,
      notionalUsdt: tradeLogs.notionalUsdt,
      status: tradeLogs.status,
      strategyId: tradeLogs.strategyId,
      orderId: tradeLogs.orderId,
      createdAt: tradeLogs.createdAt,
    })
    .from(tradeLogs)
    .where(eq(tradeLogs.userId, id))
    .orderBy(desc(tradeLogs.createdAt))
    .limit(50);

  const volumeRows = await db
    .select({
      source: tradeLogs.source,
      volume: sql<string>`COALESCE(SUM(CAST(${tradeLogs.notionalUsdt} AS NUMERIC)), 0)::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(tradeLogs)
    .where(and(eq(tradeLogs.userId, id)))
    .groupBy(tradeLogs.source);

  const volumeBySource = { manual: "0", copy: "0", tv: "0" } as Record<
    "manual" | "copy" | "tv",
    string
  >;
  const countsBySource = { manual: 0, copy: 0, tv: 0 } as Record<
    "manual" | "copy" | "tv",
    number
  >;
  for (const v of volumeRows) {
    const s = v.source as "manual" | "copy" | "tv";
    volumeBySource[s] = v.volume;
    countsBySource[s] = v.count;
  }
  const totalVolumeUsdt = volumeRows
    .reduce((acc, v) => acc + Number(v.volume || 0), 0)
    .toFixed(8);

  const masterRequests = await db
    .select({
      id: masterAccessRequests.id,
      status: masterAccessRequests.status,
      note: masterAccessRequests.note,
      contactPhone: masterAccessRequests.contactPhone,
      reviewedBy: masterAccessRequests.reviewedBy,
      reviewedAt: masterAccessRequests.reviewedAt,
      createdAt: masterAccessRequests.createdAt,
    })
    .from(masterAccessRequests)
    .where(eq(masterAccessRequests.userId, id))
    .orderBy(desc(masterAccessRequests.createdAt));

  return NextResponse.json({
    user: {
      ...user,
      createdAt: user.createdAt.toISOString(),
    },
    strategies: createdStrategies.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
    subscriptions: userSubs.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
    tvWebhooks: userTvWebhooks.map((t) => ({
      ...t,
      lastDeliveryAt: t.lastDeliveryAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
    recentTrades: recentTrades.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    volume: {
      totalUsdt: totalVolumeUsdt,
      bySource: volumeBySource,
      countsBySource,
    },
    masterRequests: masterRequests.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
      reviewedAt: m.reviewedAt?.toISOString() ?? null,
    })),
  });
}
