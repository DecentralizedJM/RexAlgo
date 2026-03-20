import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listAllAssets, getAsset } from "@/lib/mudrex";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const symbol = req.nextUrl.searchParams.get("symbol");

  try {
    if (symbol) {
      const asset = await getAsset(session.apiSecret, symbol);
      return NextResponse.json({ asset });
    }

    const assets = await listAllAssets(session.apiSecret);
    return NextResponse.json({ assets });
  } catch (error) {
    console.error("Assets fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 });
  }
}
