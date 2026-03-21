/**
 * Shared options so data updates when you return to the tab (if stale) without constant polling.
 * Pair with a manual “Refresh” in the nav for on-demand Mudrex sync (rate-limit friendly).
 */
export const liveDataQueryOptions = {
  staleTime: 15_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;
