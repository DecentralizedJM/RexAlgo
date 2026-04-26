import { NextRequest, NextResponse } from "next/server";
import { db, ensureDbReady } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function xmlEscape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const RISK_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
};

function buildSvg(opts: {
  name: string;
  symbol: string;
  type: "copy_trading" | "algo";
  winRate: number;
  subscriberCount: number;
  riskLevel: string;
  totalPnl: number;
}) {
  const { name, symbol, type, winRate, subscriberCount, riskLevel, totalPnl } = opts;
  const typeLabel = type === "copy_trading" ? "Copy Trading" : "Algo Strategy";
  const riskColor = RISK_COLOR[riskLevel] ?? "#6b7280";
  const pnlColor = totalPnl >= 0 ? "#22c55e" : "#ef4444";
  const pnlStr = `${totalPnl >= 0 ? "+" : ""}${totalPnl}%`;

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="400" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Accent bar -->
  <rect x="0" y="0" width="6" height="630" fill="url(#accent)"/>

  <!-- Grid lines (subtle) -->
  <line x1="0" y1="210" x2="1200" y2="210" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="0" y1="420" x2="1200" y2="420" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="400" y1="0" x2="400" y2="630" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="800" y1="0" x2="800" y2="630" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/>

  <!-- Brand -->
  <text x="64" y="76" font-family="system-ui,-apple-system,sans-serif" font-size="28" font-weight="700" fill="#ffffff" opacity="0.5">RexAlgo</text>

  <!-- Strategy name -->
  <text x="64" y="200" font-family="system-ui,-apple-system,sans-serif" font-size="58" font-weight="800" fill="#ffffff" letter-spacing="-1">${xmlEscape(truncate(name, 28))}</text>

  <!-- Symbol + type badge -->
  <rect x="64" y="228" width="${24 + symbol.length * 14 + 24}" height="40" rx="6" fill="#6366f1" fill-opacity="0.2"/>
  <text x="76" y="253" font-family="system-ui,-apple-system,sans-serif" font-size="20" font-weight="600" fill="#818cf8">${xmlEscape(symbol)}</text>
  <text x="${64 + 24 + symbol.length * 14 + 16}" y="253" font-family="system-ui,-apple-system,sans-serif" font-size="18" font-weight="500" fill="#6b7280">${xmlEscape(typeLabel)}</text>

  <!-- Risk badge -->
  <rect x="64" y="290" width="110" height="34" rx="5" fill="${riskColor}" fill-opacity="0.15"/>
  <text x="80" y="312" font-family="system-ui,-apple-system,sans-serif" font-size="16" font-weight="600" fill="${riskColor}" text-transform="capitalize">${xmlEscape(riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1))} Risk</text>

  <!-- Stats row -->
  <!-- PnL -->
  <text x="64" y="420" font-family="system-ui,-apple-system,sans-serif" font-size="18" fill="#6b7280">Total PnL</text>
  <text x="64" y="460" font-family="system-ui,-apple-system,sans-serif" font-size="44" font-weight="800" fill="${pnlColor}">${xmlEscape(pnlStr)}</text>

  <!-- Win rate -->
  <text x="380" y="420" font-family="system-ui,-apple-system,sans-serif" font-size="18" fill="#6b7280">Win Rate</text>
  <text x="380" y="460" font-family="system-ui,-apple-system,sans-serif" font-size="44" font-weight="800" fill="#ffffff">${xmlEscape(String(winRate))}%</text>

  <!-- Subscribers -->
  <text x="680" y="420" font-family="system-ui,-apple-system,sans-serif" font-size="18" fill="#6b7280">Subscribers</text>
  <text x="680" y="460" font-family="system-ui,-apple-system,sans-serif" font-size="44" font-weight="800" fill="#ffffff">${xmlEscape(String(subscriberCount))}</text>

  <!-- Footer -->
  <line x1="64" y1="530" x2="1136" y2="530" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>
  <text x="64" y="568" font-family="system-ui,-apple-system,sans-serif" font-size="18" fill="#4b5563">rexalgo.xyz · Mudrex Futures</text>
</svg>`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await ensureDbReady();

    const [strategy] = await db
      .select()
      .from(strategies)
      .where(and(eq(strategies.id, id), eq(strategies.status, "approved"), eq(strategies.isActive, true)));

    if (!strategy) {
      return new NextResponse("Not found", { status: 404 });
    }

    const svg = buildSvg({
      name: strategy.name,
      symbol: strategy.symbol,
      type: strategy.type,
      winRate: strategy.winRate,
      subscriberCount: strategy.subscriberCount,
      riskLevel: strategy.riskLevel,
      totalPnl: strategy.totalPnl,
    });

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("[og/strategy] error", err);
    return new NextResponse("Error", { status: 500 });
  }
}
