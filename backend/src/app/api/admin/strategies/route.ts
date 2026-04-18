import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { blockIfNotAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import {
  strategies,
  users,
  copyWebhookConfig,
  subscriptions,
} from "@/lib/schema";

/**
 * Admin strategy directory. Supports `?type=algo|copy_trading|all` (default all).
 * Returns creator, webhook state, subscription count.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const block = blockIfNotAdmin(session.user);
  if (block) return block;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  const base = db
    .select({
      id: strategies.id,
      name: strategies.name,
      type: strategies.type,
      symbol: strategies.symbol,
      isActive: strategies.isActive,
      creatorId: strategies.creatorId,
      creatorName: strategies.creatorName,
      creatorEmail: users.email,
      createdAt: strategies.createdAt,
      subscriberCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${subscriptions}
        WHERE ${subscriptions.strategyId} = ${strategies.id}
          AND ${subscriptions.isActive} = true
      )`,
      webhookEnabled: sql<boolean>`COALESCE((
        SELECT ${copyWebhookConfig.enabled}
        FROM ${copyWebhookConfig}
        WHERE ${copyWebhookConfig.strategyId} = ${strategies.id}
      ), false)`,
    })
    .from(strategies)
    .leftJoin(users, eq(users.id, strategies.creatorId))
    .orderBy(desc(strategies.createdAt));

  const rows =
    type === "algo" || type === "copy_trading"
      ? await base.where(eq(strategies.type, type))
      : await base;

  return NextResponse.json({
    strategies: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
