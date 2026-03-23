import { NextRequest, NextResponse } from "next/server";
import { requireMudrexSession } from "@/lib/auth";
import {
  createOrder,
  listOpenOrders,
  getOrderHistory,
  cancelOrder,
} from "@/lib/mudrex";
import { jsonFromMudrexError } from "@/lib/mudrexHttp";
import type { CreateOrderParams } from "@/types";

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
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Orders fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const result = await requireMudrexSession();
  if ("error" in result) return result.response;
  const session = result;

  try {
    const body = await req.json();

    if (body.action === "cancel") {
      const success = await cancelOrder(session.apiSecret, body.orderId);
      return NextResponse.json({ success });
    }

    const params: CreateOrderParams = {
      symbol: body.symbol,
      side: body.side,
      quantity: body.quantity,
      leverage: body.leverage || "1",
      triggerType: body.triggerType || "MARKET",
      price: body.price,
      stoplosPrice: body.stoplosPrice,
      takeprofitPrice: body.takeprofitPrice,
      reduceOnly: body.reduceOnly,
    };

    const order = await createOrder(session.apiSecret, params);
    return NextResponse.json({ order });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Order action error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Order action failed" },
      { status: 500 }
    );
  }
}
