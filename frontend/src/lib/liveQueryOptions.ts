/** Refetch when the tab is focused again (if stale). Nav “Refresh” forces a pull. */
export const liveDataQueryOptions = {
  staleTime: 15_000,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;
