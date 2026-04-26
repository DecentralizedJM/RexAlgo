import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { db, ensureDbReady } from "@/lib/db";
import { strategies } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const RISK_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await ensureDbReady();

    const [strategy] = await db
      .select()
      .from(strategies)
      .where(and(eq(strategies.id, id), eq(strategies.status, "approved"), eq(strategies.isActive, true)));

    if (!strategy) {
      return new Response("Not found", { status: 404 });
    }

    const typeLabel = strategy.type === "copy_trading" ? "Copy Trading" : "Algo Strategy";
    const riskColor = RISK_COLOR[strategy.riskLevel] ?? "#6b7280";
    const totalPnl = strategy.totalPnl;
    const pnlStr = `${totalPnl >= 0 ? "+" : ""}${totalPnl}%`;
    const pnlColor = totalPnl >= 0 ? "#22c55e" : "#ef4444";
    const title = truncate(strategy.name, 28);

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: "linear-gradient(160deg, #0a0a0a 0%, #111827 55%, #0f172a 100%)",
            padding: "56px 64px",
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 26,
              fontWeight: 700,
              color: "rgba(255,255,255,0.45)",
            }}
          >
            RexAlgo
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 36,
              fontSize: 52,
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1.08,
              letterSpacing: -1,
              maxWidth: 1050,
            }}
          >
            {title}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 22,
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "rgba(99, 102, 241, 0.2)",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 20,
                fontWeight: 600,
                color: "#a5b4fc",
              }}
            >
              {strategy.symbol}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 500,
                color: "#6b7280",
              }}
            >
              {typeLabel}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "rgba(148, 163, 184, 0.12)",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 15,
                fontWeight: 600,
                color: riskColor,
                textTransform: "capitalize",
              }}
            >
              {strategy.riskLevel} risk
            </div>
          </div>

          <div style={{ display: "flex", flexGrow: 1 }} />

          <div
            style={{
              display: "flex",
              flexDirection: "row",
              gap: 72,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 17, color: "#6b7280" }}>Total PnL</div>
              <div
                style={{
                  fontSize: 42,
                  fontWeight: 800,
                  color: pnlColor,
                  marginTop: 4,
                }}
              >
                {pnlStr}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 17, color: "#6b7280" }}>Win rate</div>
              <div
                style={{
                  fontSize: 42,
                  fontWeight: 800,
                  color: "#ffffff",
                  marginTop: 4,
                }}
              >
                {String(strategy.winRate)}%
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 17, color: "#6b7280" }}>Subscribers</div>
              <div
                style={{
                  fontSize: 42,
                  fontWeight: 800,
                  color: "#ffffff",
                  marginTop: 4,
                }}
              >
                {String(strategy.subscriberCount)}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 36,
              borderTop: "1px solid rgba(255,255,255,0.08)",
              paddingTop: 22,
              fontSize: 18,
              color: "#475569",
            }}
          >
            rexalgo.xyz · Mudrex Futures
          </div>
        </div>
      ),
      { width: 1200, height: 630 },
    );
  } catch (err) {
    console.error("[og/strategy] error", err);
    return new Response("Error", { status: 500 });
  }
}
