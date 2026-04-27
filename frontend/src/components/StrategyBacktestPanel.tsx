import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  runStrategyBacktest,
  ApiError,
  type StrategyBacktestResultPayload,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type EquityTooltipPayload = { value?: number; name?: string; dataKey?: string | number };

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
        Equity <span className="text-foreground/80">:</span> ${v.toFixed(2)}
      </p>
    </div>
  );
}

function downsampleEquity(
  pts: { t: number; equity: number }[],
  maxPoints: number
): { t: number; equity: number; label: string }[] {
  if (pts.length <= maxPoints) {
    return pts.map((p) => ({
      ...p,
      label: new Date(p.t).toLocaleDateString(),
    }));
  }
  const step = Math.ceil(pts.length / maxPoints);
  const out: { t: number; equity: number; label: string }[] = [];
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i]!;
    out.push({
      ...p,
      label: new Date(p.t).toLocaleDateString(),
    });
  }
  const last = pts[pts.length - 1]!;
  if (out[out.length - 1]?.t !== last.t) {
    out.push({ ...last, label: new Date(last.t).toLocaleDateString() });
  }
  return out;
}

export default function StrategyBacktestPanel({
  strategyId,
  strategyName,
}: {
  strategyId: string;
  strategyName: string;
}) {
  const navigate = useNavigate();
  const [months, setMonths] = useState("6");
  const [capital, setCapital] = useState("10000");
  const [riskPct, setRiskPct] = useState("2");
  const [indicator, setIndicator] = useState<"sma" | "ema" | "rsi">("sma");
  const [period, setPeriod] = useState("20");
  const [comparator, setComparator] = useState<"cross_above" | "cross_below" | "above" | "below">("cross_above");
  const [threshold, setThreshold] = useState("0");
  const [exitComparator, setExitComparator] = useState<"cross_above" | "cross_below" | "above" | "below">("cross_below");
  const [exitThreshold, setExitThreshold] = useState("0");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StrategyBacktestResultPayload | null>(null);
  const [metaBars, setMetaBars] = useState<number | null>(null);

  const chartData = useMemo(
    () => (result?.equity?.length ? downsampleEquity(result.equity, 400) : []),
    [result]
  );

  async function onRun() {
    setLoading(true);
    setResult(null);
    try {
      const m = Math.min(36, Math.max(1, parseInt(months, 10) || 6));
      const cap = Math.max(100, parseFloat(capital) || 10_000);
      const risk = Math.min(10, Math.max(0.5, parseFloat(riskPct) || 2)) / 100;
      const { result: r, meta } = await runStrategyBacktest(strategyId, {
        lookbackMonths: m,
        initialCapital: cap,
        riskPctPerTrade: risk,
        backtestSpec: {
          engine: "rule_builder_v1",
          params: {
            indicator,
            period: Math.max(2, parseInt(period, 10) || 20),
            comparator,
            threshold: parseFloat(threshold) || 0,
            exitComparator,
            exitThreshold: parseFloat(exitThreshold) || 0,
          },
        },
      });
      setResult(r);
      setMetaBars(meta.barsUsed);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        toast.error("Sign in to run a simulation");
        navigate("/auth", { state: { from: `/strategy/${strategyId}` } });
        return;
      }
      toast.error(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="text-lg">Simulated backtest</CardTitle>
        <CardDescription>
          Hypothetical performance for <span className="font-medium text-foreground">{strategyName}</span>{" "}
          using this listing&apos;s saved logic and historical OHLC data. Not a guarantee of live results
          on Mudrex.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-border/60 p-4 space-y-4">
          <div>
            <p className="text-sm font-medium">Rule builder</p>
            <p className="text-xs text-muted-foreground">
              Historical backtest over Bybit klines using these limited, explicit rules. This is not arbitrary strategy code.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Indicator</Label>
              <Select value={indicator} onValueChange={(v) => setIndicator(v as typeof indicator)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sma">SMA distance %</SelectItem>
                  <SelectItem value="ema">EMA value</SelectItem>
                  <SelectItem value="rsi">RSI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-period">Period</Label>
              <Input id="bt-period" type="number" min={2} max={200} value={period} onChange={(e) => setPeriod(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Entry condition</Label>
              <Select value={comparator} onValueChange={(v) => setComparator(v as typeof comparator)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cross_above">Cross above</SelectItem>
                  <SelectItem value="cross_below">Cross below</SelectItem>
                  <SelectItem value="above">Above</SelectItem>
                  <SelectItem value="below">Below</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-threshold">Entry threshold</Label>
              <Input id="bt-threshold" type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Exit condition</Label>
              <Select value={exitComparator} onValueChange={(v) => setExitComparator(v as typeof exitComparator)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cross_above">Cross above</SelectItem>
                  <SelectItem value="cross_below">Cross below</SelectItem>
                  <SelectItem value="above">Above</SelectItem>
                  <SelectItem value="below">Below</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bt-exit-threshold">Exit threshold</Label>
              <Input id="bt-exit-threshold" type="number" value={exitThreshold} onChange={(e) => setExitThreshold(e.target.value)} className="font-mono" />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>History</Label>
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger>
                <SelectValue placeholder="Months" />
              </SelectTrigger>
              <SelectContent>
                {[1, 3, 6, 12, 24, 36].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} mo
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bt-cap">Starting capital (USDT)</Label>
            <Input
              id="bt-cap"
              type="number"
              min={100}
              step={100}
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bt-risk">Risk / trade (% of equity)</Label>
            <Input
              id="bt-risk"
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={riskPct}
              onChange={(e) => setRiskPct(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              className="w-full"
              disabled={loading}
              onClick={() => void onRun()}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run simulation
                </>
              )}
            </Button>
          </div>
        </div>

        {metaBars != null && (
          <p className="text-xs text-muted-foreground">
            Bars used: {metaBars.toLocaleString()} (same timeframe as the listing).
          </p>
        )}

        {result && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Metric label="Return" value={`${result.summary.totalReturnPct >= 0 ? "+" : ""}${result.summary.totalReturnPct.toFixed(2)}%`} positive={result.summary.totalReturnPct >= 0} />
              <Metric label="Final equity" value={`$${result.summary.finalEquity.toFixed(2)}`} />
              <Metric label="Max drawdown" value={`${result.summary.maxDrawdownPct.toFixed(2)}%`} warn />
              <Metric label="Win rate" value={`${result.summary.winRatePct.toFixed(1)}%`} />
              <Metric label="Trades" value={String(result.summary.tradeCount)} />
              <Metric label="Fees (est.)" value={`$${result.summary.feesApproxUsdt.toFixed(2)}`} />
            </div>

            {chartData.length > 0 && (
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      className="text-muted-foreground"
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
                    />
                    <Tooltip
                      content={(props) => <EquityTooltip {...props} />}
                      cursor={{ stroke: "hsl(var(--muted-foreground) / 0.35)", strokeWidth: 1 }}
                      wrapperStyle={{ outline: "none" }}
                      isAnimationActive={false}
                    />
                    <Line type="monotone" dataKey="equity" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {result.trades.length > 0 && (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <p className="text-xs font-medium px-3 py-2 bg-secondary/40 border-b border-border/60">
                  Recent trades (up to 200)
                </p>
                <div className="max-h-48 overflow-y-auto text-xs font-mono">
                  <table className="w-full">
                    <thead className="text-muted-foreground sticky top-0 bg-background">
                      <tr className="border-b border-border/50">
                        <th className="text-left p-2">Side</th>
                        <th className="text-right p-2">PnL</th>
                        <th className="text-right p-2">Exit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((t, i) => (
                        <tr key={i} className="border-b border-border/30">
                          <td className="p-2">{t.side}</td>
                          <td className={`p-2 text-right ${t.pnlUsdt >= 0 ? "text-profit" : "text-loss"}`}>
                            {t.pnlUsdt >= 0 ? "+" : ""}
                            {t.pnlUsdt.toFixed(2)}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">{t.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
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
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <p
        className={`font-mono font-semibold text-sm ${
          positive === true ? "text-profit" : positive === false ? "text-loss" : warn ? "text-warning" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
