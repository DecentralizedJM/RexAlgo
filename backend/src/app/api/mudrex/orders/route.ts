import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireMudrexSession } from "@/lib/auth";
import {
  createOrder,
  listOpenOrders,
  getOrderHistory,
  cancelOrder,
} from "@/lib/mudrex";
import { jsonFromMudrexError } from "@/lib/mudrexHttp";
import { logTrade } from "@/lib/tradeLedger";
import {
  getMudrexOrderIdempotentResponse,
  setMudrexOrderIdempotentResponse,
} from "@/lib/orderIdempotency";
import { logger } from "@/lib/logger";
import type { CreateOrderParams } from "@/types";

function parseOrderSide(value: unknown): CreateOrderParams["side"] {
  if (value === "LONG" || value === "SHORT") return value;
  throw new Error("side must be LONG or SHORT");
}

function parseTriggerType(value: unknown): CreateOrderParams["triggerType"] {
  if (value === "LIMIT" || value === "MARKET" || value === undefined) {
    return value ?? "MARKET";
  }
  throw new Error("triggerType must be MARKET or LIMIT");
}

export async function GET(req: NextRequest) {
  const result = await requireMudrexSession();
  if ("error" in result) return result.response;
  const session = result;

  const history = req.nextUrl.searchParams.get("history") === "true";

  try {
    if (history) {
      const orders = await getOrderHistory(session.apiSecret);
      return NextResponse.json({ orders });
    }
    const orders = await listOpenOrders(session.apiSecret);
    return NextResponse.json({ orders });
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        (error.message.startsWith("side must") ||
          error.message.startsWith("triggerType must")))
    ) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid request body" },
        { status: 400 }
      );
    }
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    logger.error({ err: error }, "Orders fetch error");
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const result = await requireMudrexSession();
  if ("error" in result) return result.response;
  const session = result;

  try {
    const rawBody = await req.text();
    const requestHash = crypto
      .createHash("sha256")
      .update(rawBody, "utf8")
      .digest("hex");
    const body = JSON.parse(rawBody) as Record<string, unknown>;

    if (body.action === "cancel") {
      const success = await cancelOrder(session.apiSecret, String(body.orderId ?? ""));
      return NextResponse.json({ success });
    }

    const idem =
      req.headers.get("idempotency-key")?.trim() ||
      req.headers.get("Idempotency-Key")?.trim();
    if (idem) {
      const cached = await getMudrexOrderIdempotentResponse(
        session.user.id,
        idem,
        requestHash
      );
      if (cached.status === "conflict") {
        return NextResponse.json(
          { error: "Idempotency key conflict", code: "IDEMPOTENCY_CONFLICT" },
          { status: 409 }
        );
      }
      if (cached.status === "hit") {
        return new NextResponse(cached.responseJson, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const params: CreateOrderParams = {
      symbol: String(body.symbol ?? ""),
      side: parseOrderSide(body.side),
      quantity: String(body.quantity ?? ""),
      leverage: typeof body.leverage === "string" ? body.leverage : "1",
      triggerType: parseTriggerType(body.triggerType),
      price: typeof body.price === "string" ? body.price : undefined,
      stoplosPrice:
        typeof body.stoplosPrice === "string" ? body.stoplosPrice : undefined,
      takeprofitPrice:
        typeof body.takeprofitPrice === "string" ? body.takeprofitPrice : undefined,
      reduceOnly: typeof body.reduceOnly === "boolean" ? body.reduceOnly : undefined,
    };

    const order = await createOrder(session.apiSecret, params);

    // Best-effort ledger write for admin-dashboard volume aggregation.
    void logTrade({
      userId: session.user.id,
      source: "manual",
      order,
      markPriceFallback:
        typeof body.price === "string" ? parseFloat(body.price) : null,
    });

    const out = JSON.stringify({ order });
    if (idem) {
      await setMudrexOrderIdempotentResponse(
        session.user.id,
        idem,
        requestHash,
        out
      );
    }
    return new NextResponse(out, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    logger.error({ err: error }, "Order action error");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Order action failed" },
      { status: 500 }
    );
  }
}
