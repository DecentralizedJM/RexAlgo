import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import {
  users,
  strategies,
  masterAccessRequests,
  subscriptions,
  tvWebhooks,
  tradeLogs,
} from "@/lib/schema";

/**
 * Admin user directory.
 *
 * Returns one row per user enriched with:
 *   - telegramLinked: whether the user has connected a Telegram DM channel.
 *   - masterStatus: best (approved > pending > anything else) master-access state.
 *   - strategyCount / subscriptionCount / tvWebhookCount: lightweight usage counters.
 *   - totalVolumeUsdt: forward-looking sum of `trade_logs.notional_usdt` for this user
 *     (only orders placed via RexAlgo since the local ledger was introduced).
 *
 * All enrichments are computed via correlated sub-selects to keep this a single
 * query. At small/mid scale this is fine; if the users table grows large we can
 * materialise the aggregates in a view or ledger-daily rollup.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      authProvider: users.authProvider,
      createdAt: users.createdAt,
      hasMudrexKey: sql<boolean>`(${users.apiSecretEncrypted} IS NOT NULL)`,
      telegramLinked: sql<boolean>`(${users.telegramId} IS NOT NULL)`,
      telegramUsername: users.telegramUsername,
      strategyCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${strategies} WHERE ${strategies.creatorId} = ${users.id}
      )`,
      approvedStrategyCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${strategies}
        WHERE ${strategies.creatorId} = ${users.id}
          AND ${strategies.status} = 'approved'
      )`,
      subscriptionCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${subscriptions}
        WHERE ${subscriptions.userId} = ${users.id}
          AND ${subscriptions.isActive} = true
      )`,
      tvWebhookCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${tvWebhooks}
        WHERE ${tvWebhooks.userId} = ${users.id}
      )`,
      totalVolumeUsdt: sql<string | null>`(
        SELECT COALESCE(SUM(CAST(${tradeLogs.notionalUsdt} AS NUMERIC)), 0)::text
        FROM ${tradeLogs}
        WHERE ${tradeLogs.userId} = ${users.id}
          AND ${tradeLogs.notionalUsdt} IS NOT NULL
      )`,
      masterStatus: sql<string | null>`(
        SELECT ${masterAccessRequests.status}
        FROM ${masterAccessRequests}
        WHERE ${masterAccessRequests.userId} = ${users.id}
        ORDER BY
          CASE ${masterAccessRequests.status}
            WHEN 'approved' THEN 0
            WHEN 'pending' THEN 1
            ELSE 2
          END,
          ${masterAccessRequests.createdAt} DESC
        LIMIT 1
      )`,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return NextResponse.json({
    users: rows.map((r) => ({
      ...r,
      totalVolumeUsdt: r.totalVolumeUsdt ?? "0",
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
