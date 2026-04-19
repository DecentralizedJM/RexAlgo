import { cn } from "@/lib/utils";
import tvMarkSrc from "@/assets/tradingview-mark.svg?url";

/**
 * Media-kit `square-logo-black.svg` bundled as a URL. Rendered with a fixed **square**
 * box so flex/CSS cannot stretch the mark non-uniformly.
 */
export function TradingViewMark({
  className,
  height = 16,
}: {
  className?: string;
  /** Square edge length in CSS pixels. */
  height?: number;
}) {
  const px = `${height}px`;
  return (
    <img
      src={tvMarkSrc}
      alt="TradingView"
      width={height}
      height={height}
      decoding="async"
      draggable={false}
      className={cn("block shrink-0 max-w-none select-none object-contain", className)}
      style={{
        width: px,
        height: px,
        minWidth: px,
        minHeight: px,
        flexShrink: 0,
      }}
    />
  );
}
