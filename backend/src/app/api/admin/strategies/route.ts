import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
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
 * Admin strategy directory. Supports `?type=algo|copy_trading|all` (default all)
 * and `?status=draft|pending|approved|rejected|all` (default all).
 * Returns creator, webhook state, subscription count, review status.
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
  const statusParam = url.searchParams.get("status") ?? "all";

  const clauses: SQL<unknown>[] = [];
  if (type === "algo" || type === "copy_trading") {
    clauses.push(eq(strategies.type, type));
  }
  if (statusParam !== "all") {
    const parsed = statusParam
      .split(",")
      .map((s) => s.trim())
      .filter(
        (s): s is "draft" | "pending" | "approved" | "rejected" =>
          s === "draft" ||
          s === "pending" ||
          s === "approved" ||
          s === "rejected"
      );
    if (parsed.length > 0) {
      clauses.push(inArray(strategies.status, parsed));
    }
  }

  const base = db
    .select({
      id: strategies.id,
      name: strategies.name,
      type: strategies.type,
      symbol: strategies.symbol,
      isActive: strategies.isActive,
      status: strategies.status,
      rejectionReason: strategies.rejectionReason,
      reviewedBy: strategies.reviewedBy,
      reviewedAt: strategies.reviewedAt,
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
      webhookLastDeliveryAt: sql<Date | null>`(
        SELECT ${copyWebhookConfig.lastDeliveryAt}
        FROM ${copyWebhookConfig}
        WHERE ${copyWebhookConfig.strategyId} = ${strategies.id}
        LIMIT 1
      )`,
    })
    .from(strategies)
    .leftJoin(users, eq(users.id, strategies.creatorId))
    .orderBy(desc(strategies.createdAt));

  const rows =
    clauses.length > 0 ? await base.where(and(...clauses)) : await base;

  return NextResponse.json({
    strategies: rows.map((r) => ({
      ...r,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      webhookLastDeliveryAt: r.webhookLastDeliveryAt?.toISOString() ?? null,
    })),
  });
}
