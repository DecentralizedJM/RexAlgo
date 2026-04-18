import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

type Props = {
  /** Which public list this is — tweaks the supporting line only. */
  listingKind: "algo" | "copy_trading";
  /** When the strategies API failed (network / 5xx). */
  loadError?: Error | null;
  /** Refetch query keys to retry after a failed load. */
  retryQueryKeys?: string[][];
};

/**
 * Public marketplace / copy-trading empty or error state — clear copy when there
 * are no listings yet, without implying the whole product is broken.
 */
export function PublicListingsPlaceholder({
  listingKind,
  loadError,
  retryQueryKeys = [],
}: Props) {
  const qc = useQueryClient();
  const contextLine =
    listingKind === "copy_trading"
      ? "When masters publish copy-trading listings, they will appear here."
      : "When creators publish algo strategies, they will appear here.";

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-border/80 bg-card/60 p-8 text-center shadow-sm">
      <h2 className="text-xl font-semibold text-foreground leading-snug">
        No strategies available at the moment
      </h2>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{contextLine}</p>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        Approved creators can publish from{" "}
        <span className="text-foreground font-medium">Master studio</span> (Strategy or Copy trading).
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button variant="outline" size="sm" asChild>
          <Link to="/master-studio/request">Request Master studio</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard">Dashboard</Link>
        </Button>
      </div>
      {loadError && (
        <div className="mt-8 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-left">
          <p className="text-[11px] font-medium text-muted-foreground">
            Could not load the list — you can retry or check the message below.
          </p>
          <p className="mt-1 font-mono text-xs text-loss/90 break-words">{loadError.message}</p>
          {retryQueryKeys.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3 w-full"
              onClick={() => {
                for (const key of retryQueryKeys) {
                  void qc.invalidateQueries({ queryKey: key });
                }
              }}
            >
              Retry load
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
