import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { X, Shield, TrendingUp, AlertTriangle } from "lucide-react";

interface AllocationModalProps {
  strategyName: string;
  /** "subscribe" = margin per trade for RexAlgo API */
  mode?: "allocate" | "subscribe";
  /** Mudrex futures available (balance − locked); shows warnings if margin exceeds this */
  futuresAvailableUsdt?: number | null;
  onClose: () => void;
  onConfirm: (capital: number, risk: string) => void;
}

const riskLevels = [
  {
    label: "Low",
    description: "Conservative. Lower returns, capital preservation.",
    color: "text-profit",
    est: "8-15%",
    maxLoss: "3-5%",
  },
  {
    label: "Medium",
    description: "Balanced risk-reward. Moderate drawdowns.",
    color: "text-warning",
    est: "20-50%",
    maxLoss: "10-15%",
  },
  {
    label: "High",
    description: "Aggressive. High returns, higher risk.",
    color: "text-loss",
    est: "50-150%",
    maxLoss: "20-30%",
  },
];

export default function AllocationModal({
  strategyName,
  mode = "allocate",
  futuresAvailableUsdt = null,
  onClose,
  onConfirm,
}: AllocationModalProps) {
  const [capital, setCapital] = useState([mode === "subscribe" ? 50 : 1000]);
  const [riskIndex, setRiskIndex] = useState(1);
  const risk = riskLevels[riskIndex];
  const isSubscribe = mode === "subscribe";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-up"
      style={{ animationDuration: "0.3s" }}
    >
      <div className="glass rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold">
            {isSubscribe ? "Subscribe" : "Allocate capital"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          {isSubscribe ? (
            <>
              Set <span className="text-foreground font-medium">margin per trade (USDT)</span> for{" "}
              <span className="text-foreground font-medium">{strategyName}</span>. Each mirrored trade uses
              this amount from your Mudrex futures balance (subject to leverage rules).
            </>
          ) : (
            <>
              Configure allocation for{" "}
              <span className="text-foreground font-medium">{strategyName}</span>
            </>
          )}
        </p>

        <div className="mb-6">
          <label className="text-sm font-medium mb-3 block">
            {isSubscribe ? "Margin per trade (USDT)" : "Capital amount"}
          </label>
          <div className="bg-secondary/50 rounded-xl p-4">
            <div className="text-3xl font-mono font-bold text-center mb-4">
              ${capital[0].toLocaleString()}
            </div>
            <Slider
              value={capital}
              onValueChange={setCapital}
              max={isSubscribe ? 5000 : 50000}
              min={isSubscribe ? 10 : 100}
              step={isSubscribe ? 10 : 100}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>${isSubscribe ? "10" : "100"}</span>
              <span>${isSubscribe ? "5,000" : "50,000"}</span>
            </div>
          </div>
        </div>

        {!isSubscribe && (
          <div className="mb-6">
            <label className="text-sm font-medium mb-3 block">Risk level</label>
            <div className="flex gap-2">
              {riskLevels.map((r, i) => (
                <button
                  key={r.label}
                  onClick={() => setRiskIndex(i)}
                  className={`flex-1 py-3 px-3 rounded-lg text-sm font-medium transition-all duration-200 border ${
                    riskIndex === i
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">{risk.description}</p>
          </div>
        )}

        {!isSubscribe && (
          <div className="bg-secondary/30 rounded-xl p-4 mb-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Est. returns
              </span>
              <span className={`font-mono font-semibold text-sm ${risk.color}`}>{risk.est}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Max loss
              </span>
              <span className="font-mono font-semibold text-sm text-loss">{risk.maxLoss}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <Shield className="w-4 h-4" /> Risk score
              </span>
              <span className={`font-mono font-semibold text-sm ${risk.color}`}>{risk.label}</span>
            </div>
          </div>
        )}

        {isSubscribe && futuresAvailableUsdt != null && Number.isFinite(futuresAvailableUsdt) && (
          <div className="bg-secondary/50 border border-border rounded-xl p-3 mb-4 text-xs">
            <span className="text-muted-foreground">Futures wallet (available): </span>
            <span className="font-mono font-semibold text-foreground">
              ${futuresAvailableUsdt.toFixed(2)} USDT
            </span>
          </div>
        )}

        {isSubscribe &&
          futuresAvailableUsdt != null &&
          Number.isFinite(futuresAvailableUsdt) &&
          capital[0] > futuresAvailableUsdt + 1e-6 && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 mb-6 text-xs text-warning flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Margin per trade (${capital[0]}) is above your estimated futures balance ($
                {futuresAvailableUsdt.toFixed(2)}). Add USDT to your <strong>Mudrex futures wallet</strong>{" "}
                or lower the slider — otherwise mirrored orders may fail.
              </span>
            </div>
          )}

        {isSubscribe && (
          <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 mb-6 text-xs text-warning">
            Crypto futures involve significant risk. Only allocate what you can afford to lose.
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="hero"
            disabled={
              isSubscribe &&
              futuresAvailableUsdt != null &&
              Number.isFinite(futuresAvailableUsdt) &&
              capital[0] > futuresAvailableUsdt + 1e-6
            }
            onClick={() => onConfirm(capital[0], risk.label)}
            className="flex-1"
          >
            {isSubscribe ? "Confirm subscription" : "Confirm allocation"}
          </Button>
        </div>
      </div>
    </div>
  );
}
