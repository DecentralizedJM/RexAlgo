import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  listOpenPositions,
  closePosition,
  setPositionRisk,
  getPositionHistory,
} from "@/lib/mudrex";
import { jsonFromMudrexError } from "@/lib/mudrexHttp";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const history = req.nextUrl.searchParams.get("history") === "true";

  try {
    if (history) {
      const positions = await getPositionHistory(session.apiSecret);
      return NextResponse.json({ positions });
    }
    const positions = await listOpenPositions(session.apiSecret);
    return NextResponse.json({ positions });
  } catch (error) {
    console.error("Positions fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch positions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { action, positionId, stoplosPrice, takeprofitPrice } = await req.json();

    if (action === "close") {
      const success = await closePosition(session.apiSecret, positionId);
      return NextResponse.json({ success });
    }

    if (action === "set_risk") {
      const success = await setPositionRisk(
        session.apiSecret,
        positionId,
        stoplosPrice,
        takeprofitPrice
      );
      return NextResponse.json({ success });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Position action error:", error);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
