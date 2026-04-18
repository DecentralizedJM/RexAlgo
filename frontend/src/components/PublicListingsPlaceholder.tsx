import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

type Props = {
  title: string;
  /** When the strategies API failed (network / 5xx). */
  loadError?: Error | null;
  /** Refetch query keys to retry after a failed load. */
  retryQueryKeys?: string[][];
};

/**
 * Public marketplace / copy-trading empty or error state — friendly “coming soon”
 * copy instead of implying the whole API is down.
 */
export function PublicListingsPlaceholder({
  title,
  loadError,
  retryQueryKeys = [],
}: Props) {
  const qc = useQueryClient();

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-border/80 bg-card/60 p-8 text-center shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Coming soon
      </p>
      <h2 className="mt-2 text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
        Published listings will show here once creators go live. Approved creators can publish from{" "}
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
          <p className="text-[11px] font-medium text-muted-foreground">Technical detail</p>
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
