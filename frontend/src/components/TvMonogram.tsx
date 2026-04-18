import { cn } from "@/lib/utils";

/**
 * Compact "TV" monogram used by the TV Webhooks nav item.
 *
 * Deliberately *not* TradingView's logo — we render our own two-letter mark in
 * the current text color so it inherits the navbar theme and stays distinct
 * from the trademarked TradingView wordmark.
 */
export function TvMonogram({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[4px] border border-current font-mono font-semibold leading-none",
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(8, size - 6) }}
      aria-hidden
    >
      TV
    </span>
  );
}
