import type { QueryClient } from "@tanstack/react-query";

/** Invalidate active wallet, positions, strategies, studio, and session queries. */
export async function refreshAppData(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return (
        k === "wallet" ||
        k === "positions" ||
        k === "subscriptions" ||
        k === "strategies" ||
        k === "strategy" ||
        k === "rexalgo-trade-activity" ||
        k === "marketplace-studio" ||
        k === "copy-studio" ||
        k === "tv-webhooks" ||
        (k === "session" && q.queryKey[1] === "me")
      );
    },
  });
}
