import type { QueryClient } from "@tanstack/react-query";

/**
 * Refetch all active Mudrex-backed and app data queries (manual refresh).
 * Avoids always-on polling; use after tab focus (handled by React Query) or user click.
 */
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
        k === "marketplace-studio" ||
        k === "copy-studio" ||
        (k === "session" && q.queryKey[1] === "me")
      );
    },
  });
}
