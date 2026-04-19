import { cn } from "@/lib/utils";

/**
 * TradingView-style “TV” mark (geometric T + dot + slanted bar) for in-app navigation.
 * Fills use `currentColor` so the icon matches the navbar theme. Intended for use
 * where you have TradingView trademark permission (e.g. nav link to TradingView-related features).
 */
export function TradingViewMark({
  className,
  size = 16,
}: {
  className?: string;
  /** CSS pixel size (square). */
  size?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 28 16"
      fill="currentColor"
      className={cn("shrink-0", className)}
      width={size}
      height={size}
      role="img"
      aria-label="TradingView"
    >
      <title>TradingView</title>
      {/* Left: T (top bar + stem from the right of the bar) */}
      <rect x="0.5" y="1.25" width="10" height="2.85" rx="0.4" />
      <rect x="7.25" y="4.1" width="2.85" height="10.65" rx="0.4" />
      {/* Middle: dot */}
      <circle cx="13.85" cy="9.75" r="2.2" />
      {/* Right: slanted bar (V leg) */}
      <path d="M 17.15 2.35 L 20.55 2.35 L 24.35 14.25 L 20.85 14.25 Z" />
    </svg>
  );
}
