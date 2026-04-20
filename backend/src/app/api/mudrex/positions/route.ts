import { NextRequest, NextResponse } from "next/server";
import { requireMudrexSession } from "@/lib/auth";
import {
  listOpenPositions,
  closePosition,
  closePositionPartial,
  reversePosition,
  setPositionRisk,
  amendPositionRisk,
  addPositionMargin,
  getLiquidationPrice,
  getPositionHistory,
} from "@/lib/mudrex";
import { jsonFromMudrexError } from "@/lib/mudrexHttp";

export async function GET(req: NextRequest) {
  const result = await requireMudrexSession();
  if ("error" in result) return result.response;
  const session = result;

  const action = req.nextUrl.searchParams.get("action");
  const history = req.nextUrl.searchParams.get("history") === "true";

  try {
    if (action === "liq_price") {
      const positionId = req.nextUrl.searchParams.get("positionId") ?? "";
      if (!positionId) {
        return NextResponse.json(
          { error: "positionId is required" },
          { status: 400 }
        );
      }
      const extMarginRaw = req.nextUrl.searchParams.get("extMargin");
      const extMargin = extMarginRaw != null ? Number(extMarginRaw) : undefined;
      const price = await getLiquidationPrice(
        session.apiSecret,
        positionId,
        Number.isFinite(extMargin) ? extMargin : undefined
      );
      return NextResponse.json({ liquidation_price: price });
    }

    if (history) {
      const positions = await getPositionHistory(session.apiSecret);
      return NextResponse.json({ positions });
    }
    const positions = await listOpenPositions(session.apiSecret);
    return NextResponse.json({ positions });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Positions fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch positions" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const result = await requireMudrexSession();
  if ("error" in result) return result.response;
  const session = result;

  try {
    const body = (await req.json()) as {
      action?: string;
      positionId?: string;
      stoplosPrice?: string;
      takeprofitPrice?: string;
      quantity?: string;
      margin?: number | string;
    };

    const { action, positionId } = body;

    if (!positionId) {
      return NextResponse.json(
        { error: "positionId is required" },
        { status: 400 }
      );
    }

    if (action === "close") {
      const success = await closePosition(session.apiSecret, positionId);
      return NextResponse.json({ success });
    }

    if (action === "partial_close") {
      if (!body.quantity) {
        return NextResponse.json(
          { error: "quantity is required for partial_close" },
          { status: 400 }
        );
      }
      const success = await closePositionPartial(
        session.apiSecret,
        positionId,
        String(body.quantity)
      );
      return NextResponse.json({ success });
    }

    if (action === "reverse") {
      const success = await reversePosition(session.apiSecret, positionId);
      return NextResponse.json({ success });
    }

    if (action === "set_risk") {
      const success = await setPositionRisk(
        session.apiSecret,
        positionId,
        body.stoplosPrice,
        body.takeprofitPrice
      );
      return NextResponse.json({ success });
    }

    if (action === "amend_risk") {
      const success = await amendPositionRisk(
        session.apiSecret,
        positionId,
        body.stoplosPrice,
        body.takeprofitPrice
      );
      return NextResponse.json({ success });
    }

    if (action === "add_margin") {
      const marginNum =
        typeof body.margin === "number" ? body.margin : Number(body.margin);
      if (!Number.isFinite(marginNum) || marginNum === 0) {
        return NextResponse.json(
          { error: "margin must be a non-zero number" },
          { status: 400 }
        );
      }
      const data = await addPositionMargin(
        session.apiSecret,
        positionId,
        marginNum
      );
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Position action error:", error);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
