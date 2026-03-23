import { NextRequest, NextResponse } from "next/server";
import { requireMudrexSession } from "@/lib/auth";
import { getSpotBalance, getFuturesBalance, transferFunds } from "@/lib/mudrex";
import { jsonFromMudrexError } from "@/lib/mudrexHttp";

const STAGGER_MS = 150;

export async function GET(req: NextRequest) {
  const result = await requireMudrexSession();
  if ("error" in result) return result.response;
  const session = result;

  const futuresOnly =
    req.nextUrl.searchParams.get("futuresOnly") === "1" ||
    req.nextUrl.searchParams.get("scope") === "futures";

  try {
    if (futuresOnly) {
      const futures = await getFuturesBalance(session.apiSecret);
      return NextResponse.json({ futures });
    }

    // Full wallet: sequential calls reduce burst traffic vs Promise.all (helps Mudrex 429 limits).
    const spot = await getSpotBalance(session.apiSecret);
    await new Promise((r) => setTimeout(r, STAGGER_MS));
    const futures = await getFuturesBalance(session.apiSecret);

    return NextResponse.json({ spot, futures });
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Wallet fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch wallet data" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const result = await requireMudrexSession();
  if ("error" in result) return result.response;
  const session = result;

  try {
    const { from, to, amount } = await req.json();
    const result = await transferFunds(session.apiSecret, from, to, amount);
    return NextResponse.json(result);
  } catch (error) {
    const mudrex = jsonFromMudrexError(error);
    if (mudrex) return mudrex;
    console.error("Transfer error:", error);
    return NextResponse.json({ error: "Transfer failed" }, { status: 500 });
  }
}
