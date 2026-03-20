import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSpotBalance, getFuturesBalance, transferFunds } from "@/lib/mudrex";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [spot, futures] = await Promise.all([
      getSpotBalance(session.apiSecret),
      getFuturesBalance(session.apiSecret),
    ]);

    return NextResponse.json({ spot, futures });
  } catch (error) {
    console.error("Wallet fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch wallet data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { from, to, amount } = await req.json();
    const result = await transferFunds(session.apiSecret, from, to, amount);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Transfer error:", error);
    return NextResponse.json({ error: "Transfer failed" }, { status: 500 });
  }
}
