import { NextRequest, NextResponse } from "next/server";
import { requireMudrexSession } from "@/lib/auth";
import { listAllAssets, getAsset } from "@/lib/mudrex";
import { jsonFromMudrexError } from "@/lib/mudrexHttp";

export async function GET(req: NextRequest) {
  const result = await requireMudrexSession();
  if ("error" in result) return result.response;
  const session = result;

  const symbol = req.nextUrl.searchParams.get("symbol");

  try {
    if (symbol) {
      const asset = await getAsset(session.apiSecret, symbol);
      return NextResponse.json({ asset });
    }

    const assets = await listAllAssets(session.apiSecret);
    return NextResponse.json({ assets });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Assets fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 });
  }
}
