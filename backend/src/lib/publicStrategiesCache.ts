import { revalidateTag } from "next/cache";

/** Tag for `unstable_cache` on GET `/api/strategies` (public listing). */
export const PUBLIC_STRATEGIES_CACHE_TAG = "public-strategies-list";

export function revalidatePublicStrategiesList(): void {
  revalidateTag(PUBLIC_STRATEGIES_CACHE_TAG, "max");
}
