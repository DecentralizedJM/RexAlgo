/**
 * Strategy backtest panel.
 *
 * Renders the creator-uploaded backtest payload (`strategy.backtestUpload`)
 * read-only. The previous version ran a server-side simulator
 * (`sma_cross` / `rule_builder_v1`) against live Bybit klines, which could
 * not model SMC, order blocks, liquidity, or volume strategies. Creators
 * now publish their own backtest results via
 * `StudioBacktestUploader` and this panel just visualises the payload.
 *
 * If `backtestUpload` is null we show an empty-state instead of running
 * anything — there is no fallback simulator anymore.
 */
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type {
  StrategyBacktestUpload,
  StrategyBacktestUploadEquityPoint,
} from "@/lib/api";

type EquityTooltipPayload = {
  value?: number;
  name?: string;
  dataKey?: string | number;
};

function EquityTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: EquityTooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  if (typeof v !== "number") return null;
  return (
    <div className="min-w-[9rem] rounded-md border border-border bg-popover px-3 py-2 text-left shadow-lg !outline-none">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-popover-foreground">
        Equity <span className="text-foreground/80">:</span>{" "}
        {v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </p>
    </div>
  );
}

function downsampleEquity(
  pts: StrategyBacktestUploadEquityPoint[],
  maxPoints: number
): { t: string; v: number; label: string }[] {
  if (!pts.length) return [];
  const decorate = (p: StrategyBacktestUploadEquityPoint) => ({
    ...p,
    label: new Date(p.t).toLocaleDateString(),
  });
  if (pts.length <= maxPoints) return pts.map(decorate);
  const step = Math.ceil(pts.length / maxPoints);
  const out: { t: string; v: number; label: string }[] = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push(decorate(pts[i]!));
  }
  const last = pts[pts.length - 1]!;
  if (out[out.length - 1]?.t !== last.t) out.push(decorate(last));
  return out;
}

export default function StrategyBacktestPanel({
  strategyName,
  upload,
}: {
  strategyName: string;
  upload: StrategyBacktestUpload | null | undefined;
}) {
  const chartData = useMemo(
    () => (upload?.payload.equity?.length ? downsampleEquity(upload.payload.equity, 400) : []),
    [upload]
  );

  if (!upload) {
    return (
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="text-lg">Backtest</CardTitle>
          <CardDescription>
            The creator hasn&rsquo;t published a backtest for{" "}
            <span className="font-medium text-foreground">{strategyName}</span> yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          When the creator uploads their backtest results JSON or a TradingView
          Strategy Tester export, the equity curve, win rate, max drawdown and
          recent trades will appear here.
        </CardContent>
      </Card>
    );
  }

  const { summary, trades } = upload.payload;
  const initialCapital = summary.initialCapital;
  const formatEquity = (v: number) =>
    initialCapital
      ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const sourceLabel =
    upload.kind === "tv_export"
      ? "TradingView Strategy Tester export"
      : "Uploaded backtest JSON";

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="text-lg">Backtest</CardTitle>
        <CardDescription>
          Creator-published backtest for{" "}
          <span className="font-medium text-foreground">{strategyName}</span>{" "}
          ({sourceLabel}). Past performance is not a guarantee of live results
          on Mudrex.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Metric
            label="Return"
            value={`${summary.totalReturnPct >= 0 ? "+" : ""}${summary.totalReturnPct.toFixed(2)}%`}
            positive={summary.totalReturnPct >= 0}
          />
          <Metric label="Win rate" value={`${summary.winRatePct.toFixed(1)}%`} />
          <Metric
            label="Max drawdown"
            value={`${summary.maxDrawdownPct.toFixed(2)}%`}
            warn
          />
          <Metric label="Trades" value={String(summary.trades)} />
          {typeof summary.profitFactor === "number" && (
            <Metric
              label="Profit factor"
              value={summary.profitFactor.toFixed(2)}
            />
          )}
          {typeof summary.sharpe === "number" && (
            <Metric label="Sharpe" value={summary.sharpe.toFixed(2)} />
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Range:{" "}
          {new Date(summary.rangeStart).toLocaleDateString()}{" "}
          &rarr; {new Date(summary.rangeEnd).toLocaleDateString()}
          {upload.meta.fileName ? ` · ${upload.meta.fileName}` : null}
        </p>

        {chartData.length > 0 && (
          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  className="text-muted-foreground"
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => formatEquity(Number(v))}
                />
                <Tooltip
                  content={(props) => (
                    <EquityTooltip
                      {...(props as unknown as {
                        active?: boolean;
                        payload?: EquityTooltipPayload[];
                        label?: string;
                      })}
                    />
                  )}
                  cursor={{
                    stroke: "hsl(var(--muted-foreground) / 0.35)",
                    strokeWidth: 1,
                  }}
                  wrapperStyle={{ outline: "none" }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="hsl(var(--primary))"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {trades.length > 0 && (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <p className="text-xs font-medium px-3 py-2 bg-secondary/40 border-b border-border/60">
              Trades ({trades.length})
            </p>
            <div className="max-h-72 overflow-y-auto text-xs font-mono">
              <table className="w-full">
                <thead className="text-muted-foreground sticky top-0 bg-background">
                  <tr className="border-b border-border/50">
                    <th className="text-left p-2">Side</th>
                    <th className="text-left p-2">Entry</th>
                    <th className="text-left p-2">Exit</th>
                    <th className="text-right p-2">P/L</th>
                    <th className="text-right p-2">P/L %</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 200).map((t, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="p-2 uppercase">{t.side}</td>
                      <td className="p-2 text-muted-foreground">
                        {new Date(t.entryTime).toLocaleString()}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {new Date(t.exitTime).toLocaleString()}
                      </td>
                      <td
                        className={`p-2 text-right ${
                          t.pnl >= 0 ? "text-profit" : "text-loss"
                        }`}
                      >
                        {t.pnl >= 0 ? "+" : ""}
                        {t.pnl.toFixed(2)}
                      </td>
                      <td
                        className={`p-2 text-right ${
                          t.pnlPct >= 0 ? "text-profit" : "text-loss"
                        }`}
                      >
                        {t.pnlPct >= 0 ? "+" : ""}
                        {t.pnlPct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  positive,
  warn,
}: {
  label: string;
  value: string;
  positive?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </p>
      <p
        className={`font-mono font-semibold text-sm ${
          positive === true
            ? "text-profit"
            : positive === false
              ? "text-loss"
              : warn
                ? "text-warning"
                : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
