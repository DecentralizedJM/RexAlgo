/**
 * Creator-only uploader that publishes the strategy's backtest payload.
 *
 * Two input flavours, both producing the same `StrategyBacktestUpload` on
 * success (the panel reads that uniform shape):
 *
 *   1. "Paste JSON" — creator hand-crafts or exports the canonical shape:
 *      { summary: { totalReturnPct, winRatePct, maxDrawdownPct, trades,
 *                   rangeStart, rangeEnd, ... },
 *        equity:  [{ t, v }, ...],
 *        trades:  [{ entryTime, exitTime, side, entry, exit, qty,
 *                    pnl, pnlPct }, ...] }
 *
 *   2. "TradingView export" — creator uploads the "List of Trades" CSV that
 *      TradingView's Strategy Tester emits. Server-side `parseTvExport.ts`
 *      translates it to the canonical shape before persisting.
 *
 * The uploader is deliberately a single component with a tab-style switch
 * — keeps the studio surface small while making both paths discoverable.
 * `onUploaded` lets the parent invalidate query caches and show a toast.
 */
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  uploadCopyStrategyBacktest,
  uploadMarketplaceStrategyBacktest,
  deleteCopyStrategyBacktest,
  deleteMarketplaceStrategyBacktest,
  type BacktestUploadKind,
  type StrategyBacktestUpload,
} from "@/lib/api";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Tab = "json" | "tv_export";

export interface StudioBacktestUploaderProps {
  strategyId: string;
  strategyType: "algo" | "copy_trading";
  /** Currently published upload, if any — we render its source for context. */
  current: StrategyBacktestUpload | null | undefined;
  /** Fired on success/delete so the parent can invalidate its query cache. */
  onUploaded: () => void;
}

const SAMPLE_JSON = JSON.stringify(
  {
    exampleOnly: true,
    summary: {
      totalReturnPct: 38.4,
      winRatePct: 54.1,
      maxDrawdownPct: 11.7,
      trades: 124,
      rangeStart: "2023-01-01T00:00:00Z",
      rangeEnd: "2024-01-01T00:00:00Z",
      profitFactor: 1.62,
      initialCapital: 10000,
    },
    equity: [
      { t: "2023-01-02T00:00:00Z", v: 10000 },
      { t: "2023-12-31T00:00:00Z", v: 13840 },
    ],
    trades: [
      {
        entryTime: "2023-01-05T08:00:00Z",
        exitTime: "2023-01-05T11:00:00Z",
        side: "long",
        entry: 16800,
        exit: 17050,
        qty: 0.05,
        pnl: 12.5,
        pnlPct: 1.49,
      },
    ],
  },
  null,
  2
);

export default function StudioBacktestUploader({
  strategyId,
  strategyType,
  current,
  onUploaded,
}: StudioBacktestUploaderProps) {
  const [tab, setTab] = useState<Tab>(
    current?.kind === "tv_export" ? "tv_export" : "json"
  );
  const [pasteJson, setPasteJson] = useState("");
  const [pasteTv, setPasteTv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const tvFileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadMut = useMutation({
    mutationFn: async (input: { kind: BacktestUploadKind; body: unknown }) => {
      if (strategyType === "algo") {
        return uploadMarketplaceStrategyBacktest(strategyId, {
          kind: input.kind,
          body: input.body,
          fileName,
        });
      }
      return uploadCopyStrategyBacktest(strategyId, {
        kind: input.kind,
        body: input.body,
        fileName,
      });
    },
    onSuccess: (data) => {
      toast.success("Backtest published", {
        description:
          "notice" in data && typeof data.notice === "string"
            ? data.notice
            : undefined,
      });
      setPasteJson("");
      setPasteTv("");
      setFileName(null);
      if (tvFileInputRef.current) tvFileInputRef.current.value = "";
      onUploaded();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Upload failed");
    },
  });

  const deleteMut = useMutation({
    mutationFn: () =>
      strategyType === "algo"
        ? deleteMarketplaceStrategyBacktest(strategyId)
        : deleteCopyStrategyBacktest(strategyId),
    onSuccess: () => {
      toast.success("Backtest cleared");
      onUploaded();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Could not clear backtest");
    },
  });

  function submitJson() {
    const body = pasteJson.trim();
    if (!body) {
      toast.error("Paste a JSON backtest payload first");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      toast.error(
        e instanceof Error
          ? `Invalid JSON: ${e.message}`
          : "Could not parse JSON body"
      );
      return;
    }
    uploadMut.mutate({ kind: "json", body: parsed });
  }

  function submitTv() {
    const body = pasteTv.trim();
    if (!body) {
      toast.error("Paste a TradingView export, or pick a CSV/JSON file first");
      return;
    }
    uploadMut.mutate({ kind: "tv_export", body });
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      toast.error("File is over 1 MB. Trim the export and try again.");
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    setPasteTv(text);
  }

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="text-xl">Publish your backtest</CardTitle>
        <CardDescription>
          Step action happens here. Upload real, self-attested results from
          TradingView, your own engine, or any tool that produces a closed
          trade list. RexAlgo validates consistency, date span, trade count,
          and shape, but cannot prove external truth without a trusted import.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="inline-flex rounded-md border border-border bg-secondary/30 p-1 text-sm">
          <TabButton active={tab === "json"} onClick={() => setTab("json")}>
            Paste JSON
          </TabButton>
          <TabButton
            active={tab === "tv_export"}
            onClick={() => setTab("tv_export")}
          >
            TradingView export
          </TabButton>
        </div>

        {tab === "json" ? (
          <div className="space-y-2">
            <Label htmlFor="bt-json">Backtest payload (JSON)</Label>
            <Textarea
              id="bt-json"
              rows={12}
              value={pasteJson}
              onChange={(e) => setPasteJson(e.target.value)}
              placeholder={SAMPLE_JSON}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Required: <code>summary.totalReturnPct</code>,{" "}
              <code>summary.winRatePct</code>,{" "}
              <code>summary.maxDrawdownPct</code>, <code>summary.trades</code>,{" "}
              <code>summary.rangeStart</code>, <code>summary.rangeEnd</code>.
              Also required: at least 90 days, 20 closed trades, a matching
              <code> trades</code> array, and at least two equity points.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={uploadMut.isPending}
                onClick={submitJson}
              >
                {uploadMut.isPending && uploadMut.variables?.kind === "json" ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-1" />
                )}
                Publish JSON backtest
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setPasteJson(SAMPLE_JSON)}
              >
                View example format
              </Button>
            </div>
            <p className="text-xs text-warning">
              The example includes <code>exampleOnly: true</code> and cannot be
              published unchanged.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                Export from TradingView
              </p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>
                  Open the chart with your strategy attached, switch to the
                  Strategy Tester panel.
                </li>
                <li>
                  Click the export icon and choose <em>List of Trades</em>{" "}
                  (CSV). Summary-only exports cannot be used for admin review.
                </li>
                <li>Drop the file below or paste its contents.</li>
              </ol>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bt-tv-file">CSV / JSON file</Label>
              <input
                ref={tvFileInputRef}
                id="bt-tv-file"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={(e) => void onPickFile(e)}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-secondary/80"
              />
              {fileName && (
                <p className="text-xs text-muted-foreground">
                  Loaded <span className="font-medium">{fileName}</span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="bt-tv-paste">Or paste contents</Label>
              <Textarea
                id="bt-tv-paste"
                rows={10}
                value={pasteTv}
                onChange={(e) => {
                  setPasteTv(e.target.value);
                  if (fileName) setFileName(null);
                }}
                placeholder="Trade #,Type,Date/Time,Price USDT,Contracts,Profit USDT,Profit %,Cumulative profit USDT&#10;1,Entry long,2023-01-05 08:00,16800,0.05,...&#10;1,Exit long,2023-01-05 11:00,17050,0.05,12.5,1.49,12.5"
                className="font-mono text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={uploadMut.isPending}
                onClick={submitTv}
              >
                {uploadMut.isPending && uploadMut.variables?.kind === "tv_export" ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-1" />
                )}
                Publish TradingView backtest
              </Button>
            </div>
          </div>
        )}

        {current && (
          <div className="rounded-md border border-border/60 bg-secondary/20 p-3 text-xs">
            <p className="font-medium text-foreground">
              Currently published
            </p>
            <p className="text-muted-foreground mt-0.5">
              {current.kind === "tv_export"
                ? "TradingView Strategy Tester export"
                : "Uploaded JSON"}
              {current.meta.fileName ? ` · ${current.meta.fileName}` : null} ·{" "}
              uploaded {new Date(current.meta.uploadedAt).toLocaleString()}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 text-loss hover:text-loss"
              disabled={deleteMut.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Remove the published backtest? Subscribers will see the empty state until you upload a new one."
                  )
                ) {
                  deleteMut.mutate();
                }
              }}
            >
              {deleteMut.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-1" />
              )}
              Clear backtest
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
