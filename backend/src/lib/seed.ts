import { db } from "./db";
import { strategies, users } from "./schema";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";
import { serializeBacktestSpec, defaultBacktestSpec } from "./backtest/spec";

const sampleStrategies = [
  {
    name: "BTC Trend Rider",
    description:
      "Trend-following strategy on Bitcoin perpetual futures. Uses EMA crossover on the 1h chart to identify trend direction. Enters on pullbacks to the 20 EMA with a 3% stop-loss and 8% take-profit target. Performs best in trending markets.",
    type: "algo" as const,
    symbol: "BTCUSDT",
    side: "BOTH" as const,
    leverage: "5",
    stoplossPct: 3,
    takeprofitPct: 8,
    riskLevel: "medium" as const,
    timeframe: "1h",
    totalPnl: 24.5,
    winRate: 62,
    totalTrades: 147,
    subscriberCount: 23,
  },
  {
    name: "ETH Mean Reversion",
    description:
      "Mean reversion strategy that fades extreme moves on Ethereum. Uses Bollinger Bands and RSI to identify overbought/oversold conditions on the 15m timeframe. Targets quick reversions to the mean with tight risk management.",
    type: "algo" as const,
    symbol: "ETHUSDT",
    side: "BOTH" as const,
    leverage: "10",
    stoplossPct: 2,
    takeprofitPct: 4,
    riskLevel: "high" as const,
    timeframe: "15m",
    totalPnl: 18.2,
    winRate: 58,
    totalTrades: 312,
    subscriberCount: 15,
  },
  {
    name: "SOL Scalper Pro",
    description:
      "High-frequency scalping strategy on Solana futures. Captures micro-movements using order flow analysis and VWAP. Extremely active with tight stops. For experienced traders comfortable with high turnover.",
    type: "copy_trading" as const,
    symbol: "SOLUSDT",
    side: "BOTH" as const,
    leverage: "15",
    stoplossPct: 1.5,
    takeprofitPct: 3,
    riskLevel: "high" as const,
    timeframe: "5m",
    totalPnl: 31.7,
    winRate: 54,
    totalTrades: 891,
    subscriberCount: 8,
  },
  {
    name: "XRP Range Trader",
    description:
      "Identifies and trades within established ranges on XRP. Buys at support, sells at resistance. Uses 4h chart for range identification with confluence from volume profile. Conservative approach with wider stops.",
    type: "algo" as const,
    symbol: "XRPUSDT",
    side: "BOTH" as const,
    leverage: "3",
    stoplossPct: 5,
    takeprofitPct: 10,
    riskLevel: "low" as const,
    timeframe: "4h",
    totalPnl: 12.3,
    winRate: 67,
    totalTrades: 58,
    subscriberCount: 41,
  },
  {
    name: "DOGE Momentum",
    description:
      "Momentum-based strategy on DOGE futures. Captures strong directional moves using volume surge detection and MACD divergence. Higher risk but higher reward potential during volatile periods.",
    type: "copy_trading" as const,
    symbol: "DOGEUSDT",
    side: "LONG" as const,
    leverage: "8",
    stoplossPct: 4,
    takeprofitPct: 12,
    riskLevel: "high" as const,
    timeframe: "30m",
    totalPnl: 45.2,
    winRate: 48,
    totalTrades: 203,
    subscriberCount: 12,
  },
  {
    name: "BNB Swing Trader",
    description:
      "Swing trading strategy on BNB. Holds positions for 1-3 days based on daily chart structure. Uses support/resistance levels with confirmation from multiple timeframe analysis. Low frequency, high conviction trades.",
    type: "algo" as const,
    symbol: "BNBUSDT",
    side: "BOTH" as const,
    leverage: "3",
    stoplossPct: 4,
    takeprofitPct: 12,
    riskLevel: "low" as const,
    timeframe: "1d",
    totalPnl: 15.8,
    winRate: 71,
    totalTrades: 34,
    subscriberCount: 56,
  },
];

export async function seedDatabase() {
  const existing = await db.select().from(strategies);
  if (existing.length > 0) return;

  const systemUsers = await db.select().from(users).where(eq(users.id, "system"));
  if (systemUsers.length === 0) {
    await db.insert(users).values({
      id: "system",
      displayName: "RexAlgo Team",
      apiSecretEncrypted: "system-no-api",
    });
  }

  const defaultSpec = serializeBacktestSpec(defaultBacktestSpec());

  for (const s of sampleStrategies) {
    await db.insert(strategies).values({
      id: uuidv4(),
      creatorId: "system",
      creatorName: "RexAlgo Team",
      name: s.name,
      description: s.description,
      type: s.type,
      symbol: s.symbol,
      side: s.side,
      leverage: s.leverage,
      stoplossPct: s.stoplossPct,
      takeprofitPct: s.takeprofitPct,
      riskLevel: s.riskLevel,
      timeframe: s.timeframe,
      backtestSpecJson: s.type === "algo" ? defaultSpec : null,
      isActive: true,
      totalPnl: s.totalPnl,
      winRate: s.winRate,
      totalTrades: s.totalTrades,
      subscriberCount: s.subscriberCount,
    });
  }

  console.log(`Seeded ${sampleStrategies.length} sample strategies`);
}
