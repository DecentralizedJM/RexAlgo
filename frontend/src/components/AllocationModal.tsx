import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { X, Shield, TrendingUp, AlertTriangle } from "lucide-react";
import {
  MARGIN_CURRENCIES,
  type MarginCurrency,
  formatMarginAmount,
} from "@/lib/subscriptionCurrency";

interface AllocationModalProps {
  strategyName: string;
  /** "subscribe" = margin per trade for RexAlgo API */
  mode?: "allocate" | "subscribe";
  /** Mudrex futures available (balance − locked); shows warnings if margin exceeds this */
  futuresAvailableUsdt?: number | null;
  onClose: () => void;
  /**
   * Subscribe flow only sends the active currency on confirm. INR is rendered
   * for awareness but disabled, so the parent never receives it today.
   */
  onConfirm: (
    capital: number,
    risk: string,
    marginCurrency: MarginCurrency
  ) => void;
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
  const isSubscribe = mode === "subscribe";
  const [currency, setCurrency] = useState<MarginCurrency>("USDT");
  const currencyOption = MARGIN_CURRENCIES[currency];

  const [capital, setCapital] = useState<number[]>([
    isSubscribe ? MARGIN_CURRENCIES.USDT.min : 1000,
  ]);
  const [riskIndex, setRiskIndex] = useState(1);
  const risk = riskLevels[riskIndex];

  // When user clicks an enabled currency, keep slider within that currency's
  // bounds. INR is disabled today so this only fires for USDT, but we keep the
  // logic generic so enabling INR later is a one-line change in the model.
  useEffect(() => {
    if (!isSubscribe) return;
    setCapital(([prev]) => {
      const safe = Number.isFinite(prev) ? prev : currencyOption.min;
      const clamped = Math.min(
        Math.max(safe, currencyOption.min),
        currencyOption.max
      );
      return [clamped];
    });
  }, [currency, currencyOption.min, currencyOption.max, isSubscribe]);

  const formattedCapital = useMemo(
    () =>
      isSubscribe
        ? formatMarginAmount(currency, capital[0])
        : `$${capital[0].toLocaleString()}`,
    [isSubscribe, currency, capital]
  );

  const showFundingWarning =
    isSubscribe &&
    currency === "USDT" &&
    futuresAvailableUsdt != null &&
    Number.isFinite(futuresAvailableUsdt) &&
    capital[0] > futuresAvailableUsdt + 1e-6;

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
              Set <span className="text-foreground font-medium">margin per trade</span> for{" "}
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

        {isSubscribe && (
          <div className="mb-5">
            <label className="text-sm font-medium mb-3 block">Margin currency</label>
            <div className="grid grid-cols-2 gap-3">
              {(Object.values(MARGIN_CURRENCIES)).map((opt) => {
                const active = currency === opt.code;
                const disabled = !opt.enabled;
                return (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => {
                      if (disabled) return;
                      setCurrency(opt.code);
                    }}
                    disabled={disabled}
                    aria-pressed={active}
                    aria-disabled={disabled}
                    className={`relative rounded-xl border p-3 text-left transition-all ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-secondary/30"
                    } ${
                      disabled
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:border-primary/60 hover:bg-secondary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold">{opt.code}</span>
                      {disabled ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wide border-warning/40 text-warning bg-warning/10"
                        >
                          Coming soon
                        </Badge>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Min {formatMarginAmount(opt.code, opt.min)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">
                      {opt.code === "USDT"
                        ? "Mudrex USDT-margined futures (live today)."
                        : "Mudrex INR futures will unlock here when Mudrex enables them."}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-6">
          <label className="text-sm font-medium mb-3 block">
            {isSubscribe
              ? `Margin per trade (${currencyOption.code})`
              : "Capital amount"}
          </label>
          <div className="bg-secondary/50 rounded-xl p-4">
            <div className="text-3xl font-mono font-bold text-center mb-4">
              {formattedCapital}
            </div>
            <Slider
              value={capital}
              onValueChange={setCapital}
              max={isSubscribe ? currencyOption.max : 50000}
              min={isSubscribe ? currencyOption.min : 100}
              step={isSubscribe ? currencyOption.step : 100}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              {isSubscribe ? (
                <>
                  <span>{formatMarginAmount(currency, currencyOption.min)}</span>
                  <span>{formatMarginAmount(currency, currencyOption.max)}</span>
                </>
              ) : (
                <>
                  <span>$100</span>
                  <span>$50,000</span>
                </>
              )}
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

        {isSubscribe &&
          currency === "USDT" &&
          futuresAvailableUsdt != null &&
          Number.isFinite(futuresAvailableUsdt) && (
            <div className="bg-secondary/50 border border-border rounded-xl p-3 mb-4 text-xs">
              <span className="text-muted-foreground">Futures wallet (available): </span>
              <span className="font-mono font-semibold text-foreground">
                ${futuresAvailableUsdt.toFixed(2)} USDT
              </span>
            </div>
          )}

        {showFundingWarning && (
          <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 mb-6 text-xs text-warning flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Margin per trade ({formattedCapital}) is above your free futures balance ($
              {(futuresAvailableUsdt ?? 0).toFixed(2)}). Add USDT on Mudrex or lower the slider so mirrors
              don’t fail.
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
              (!currencyOption.enabled || showFundingWarning === true)
            }
            onClick={() => onConfirm(capital[0], risk.label, currency)}
            className="flex-1"
          >
            {isSubscribe ? "Confirm subscription" : "Confirm allocation"}
          </Button>
        </div>
      </div>
    </div>
  );
}
