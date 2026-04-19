import { cn } from "@/lib/utils";
import tvMarkup from "@/assets/tradingview-mark.svg?raw";

/**
 * Official square logotype geometry (TradingView media kit), inlined at build time.
 * Background rect removed; mark uses `currentColor`. Use only per media-kit / trademark rules.
 */
export function TradingViewMark({
  className,
  height = 16,
}: {
  className?: string;
  /** Pixel height; width follows the SVG viewBox aspect ratio. */
  height?: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center align-middle text-current [&>svg]:block [&>svg]:h-full [&>svg]:w-auto [&>svg]:max-w-none [&>svg]:shrink-0",
        className
      )}
      style={{
        height: `${height}px`,
        width: "fit-content",
        maxWidth: "none",
        flexShrink: 0,
      }}
      role="img"
      aria-label="TradingView"
      dangerouslySetInnerHTML={{ __html: tvMarkup }}
    />
  );
}
