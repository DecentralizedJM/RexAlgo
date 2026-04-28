/**
 * Legacy simulated-backtest endpoint — deprecated.
 *
 * Used to run `sma_cross` / `rule_builder_v1` against live Bybit klines
 * each request. The simulator could not model SMC, order blocks,
 * liquidity, or volume strategies, so creators got hypothetical numbers
 * that didn't reflect what they actually traded. The replacement is a
 * creator-uploaded backtest payload (raw JSON or TradingView Strategy
 * Tester export) which the studio + public detail panel render verbatim.
 *
 * This shell is kept for one release so older clients receive a clear
 * error code instead of a 404. Remove the file once analytics confirms
 * no traffic.
 *
 * Replacement endpoints:
 *   - `POST /api/marketplace/studio/strategies/[id]/backtest-upload`
 *   - `POST /api/copy-trading/studio/strategies/[id]/backtest-upload`
 */
import { NextResponse } from "next/server";

const DEPRECATION_BODY = {
  error:
    "The simulated backtest engine has been deprecated. Upload your backtest results JSON or a TradingView Strategy Tester export from the studio instead.",
  code: "BACKTEST_LEGACY_DEPRECATED",
  replacement: {
    algo: "POST /api/marketplace/studio/strategies/{id}/backtest-upload",
    copy_trading: "POST /api/copy-trading/studio/strategies/{id}/backtest-upload",
  },
} as const;

export async function POST() {
  return NextResponse.json(DEPRECATION_BODY, { status: 410 });
}

export async function GET() {
  return NextResponse.json(DEPRECATION_BODY, { status: 410 });
}
