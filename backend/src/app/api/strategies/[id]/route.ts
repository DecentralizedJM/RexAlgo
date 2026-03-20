import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    return NextResponse.json({ strategy });
  } catch (error) {
    console.error("Strategy fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch strategy" }, { status: 500 });
  }
}
