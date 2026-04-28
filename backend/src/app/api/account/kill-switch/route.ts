import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { strategies, subscriptions, tradeLogs, users } from "@/lib/schema";
import { cancelOrder, closePosition, listOpenOrders, listOpenPositions } from "@/lib/mudrex";
import { markRexAlgoTradesClosed } from "@/lib/tradeLedger";

type CloseResult = {
  symbol: string;
  side: string;
  positionId: string;
  status: "closed" | "failed";
  detail?: string;
};

type CancelResult = {
  orderId: string;
  status: "cancelled" | "failed";
  detail?: string;
};

function positionKey(symbol: string, side: string): string {
  return `${symbol.trim().toUpperCase()}:${side.trim().toUpperCase()}`;
}

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeSubs = await db
    .select({
      id: subscriptions.id,
      strategyId: subscriptions.strategyId,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, session.user.id),
        eq(subscriptions.isActive, true)
      )
    );

  const openLedgerRows = await db
    .select({
      id: tradeLogs.id,
      orderId: tradeLogs.orderId,
      symbol: tradeLogs.symbol,
      side: tradeLogs.side,
    })
    .from(tradeLogs)
    .where(
      and(eq(tradeLogs.userId, session.user.id), eq(tradeLogs.status, "open"))
    );

  const closeResults: CloseResult[] = [];
  const cancelResults: CancelResult[] = [];

  if (session.apiSecret && openLedgerRows.length > 0) {
    const rexAlgoOrderIds = new Set(
      openLedgerRows
        .map((row) => row.orderId?.trim())
        .filter((orderId): orderId is string => Boolean(orderId))
    );

    if (rexAlgoOrderIds.size > 0) {
      try {
        const openOrders = await listOpenOrders(session.apiSecret);
        const matchingOrders = openOrders.filter((order) =>
          rexAlgoOrderIds.has(order.order_id)
        );

        for (const order of matchingOrders) {
          try {
            const ok = await cancelOrder(session.apiSecret, order.order_id);
            cancelResults.push({
              orderId: order.order_id,
              status: ok ? "cancelled" : "failed",
              ...(ok ? {} : { detail: "Mudrex returned false" }),
            });
          } catch (error) {
            cancelResults.push({
              orderId: order.order_id,
              status: "failed",
              detail: error instanceof Error ? error.message : "Cancel failed",
            });
          }
        }
      } catch (error) {
        cancelResults.push({
          orderId: "open-orders",
          status: "failed",
          detail:
            error instanceof Error ? error.message : "Could not fetch open orders",
        });
      }
    }

    const rexAlgoPositionKeys = new Set(
      openLedgerRows.map((row) => positionKey(row.symbol, row.side))
    );

    try {
      const openPositions = await listOpenPositions(session.apiSecret, "background");
      const matchingPositions = openPositions.filter((position) =>
        rexAlgoPositionKeys.has(positionKey(position.symbol, position.side))
      );

      for (const position of matchingPositions) {
        try {
          const ok = await closePosition(
            session.apiSecret,
            position.position_id,
            "background"
          );
          closeResults.push({
            symbol: position.symbol,
            side: position.side,
            positionId: position.position_id,
            status: ok ? "closed" : "failed",
            ...(ok ? {} : { detail: "Mudrex returned false" }),
          });
        } catch (error) {
          closeResults.push({
            symbol: position.symbol,
            side: position.side,
            positionId: position.position_id,
            status: "failed",
            detail: error instanceof Error ? error.message : "Close failed",
          });
        }
      }
    } catch (error) {
      closeResults.push({
        symbol: "unknown",
        side: "unknown",
        positionId: "open-positions",
        status: "failed",
        detail:
          error instanceof Error ? error.message : "Could not fetch open positions",
      });
    }
  }

  const cancelledOrderIds = cancelResults
    .filter((result) => result.status === "cancelled")
    .map((result) => result.orderId);
  if (cancelledOrderIds.length > 0) {
    await db
      .update(tradeLogs)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(tradeLogs.userId, session.user.id),
          inArray(tradeLogs.orderId, cancelledOrderIds)
        )
      );
  }

  const closedPositionKeys = new Set(
    closeResults
      .filter((result) => result.status === "closed")
      .map((result) => positionKey(result.symbol, result.side))
  );
  if (closedPositionKeys.size > 0) {
    for (const result of closeResults.filter((r) => r.status === "closed")) {
      await markRexAlgoTradesClosed({
        userId: session.user.id,
        symbol: result.symbol,
        side: result.side,
        positionId: result.positionId,
      });
    }
  }

  if (activeSubs.length > 0) {
    await db
      .update(subscriptions)
      .set({ isActive: false })
      .where(
        and(
          eq(subscriptions.userId, session.user.id),
          eq(subscriptions.isActive, true)
        )
      );

    const counts = new Map<string, number>();
    for (const sub of activeSubs) {
      counts.set(sub.strategyId, (counts.get(sub.strategyId) ?? 0) + 1);
    }
    for (const [strategyId, count] of counts) {
      await db
        .update(strategies)
        .set({
          subscriberCount: sql`GREATEST(0, ${strategies.subscriberCount} - ${count})`,
        })
        .where(eq(strategies.id, strategyId));
    }
  }

  // Kill-switch wipes the linked key — also clear the shared-key ack so the
  // dashboard warning re-arms from scratch if the user later reconnects a
  // (possibly still-shared) secret. See `mudrexKeySharing.ts`.
  await db
    .update(users)
    .set({
      apiSecretEncrypted: null,
      userSecretFingerprint: null,
      sharedMudrexAckFingerprint: null,
      sharedMudrexAckIp: null,
      sharedMudrexAckAt: null,
    })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({
    success: true,
    user: {
      id: session.user.id,
      displayName: session.user.displayName,
      email: session.user.email,
      hasMudrexKey: false,
    },
    summary: {
      subscriptionsStopped: activeSubs.length,
      rexAlgoOpenTradesFound: openLedgerRows.length,
      ordersCancelled: cancelResults.filter((r) => r.status === "cancelled").length,
      positionsClosed: closeResults.filter((r) => r.status === "closed").length,
      failures:
        cancelResults.filter((r) => r.status === "failed").length +
        closeResults.filter((r) => r.status === "failed").length,
      orderResults: cancelResults,
      positionResults: closeResults,
    },
  });
}
