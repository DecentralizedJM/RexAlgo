import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLeverage, setLeverage } from "@/lib/mudrex";
import { jsonFromMudrexError } from "@/lib/mudrexHttp";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });

  try {
    const leverage = await getLeverage(session.apiSecret, symbol);
    return NextResponse.json({ leverage });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Leverage fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch leverage" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { symbol, leverage, marginType } = await req.json();
    const result = await setLeverage(session.apiSecret, symbol, leverage, marginType);
    return NextResponse.json({ leverage: result });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Set leverage error:", error);
    return NextResponse.json({ error: "Failed to set leverage" }, { status: 500 });
  }
}
