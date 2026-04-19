import { cn } from "@/lib/utils";

/**
 * TradingView mark: chart wave + dot + corner bracket (official-style lockup).
 * Uses intrinsic width from height so the aspect ratio is not squashed in the navbar.
 * `currentColor` matches surrounding text. Use only where you have TradingView trademark permission.
 */
export function TradingViewMark({
  className,
  height = 16,
}: {
  className?: string;
  /** Renders at this height (px); width follows official ~8∶3 proportion. */
  height?: number;
}) {
  const vbW = 48;
  const vbH = 18;
  const width = (height * vbW) / vbH;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${vbW} ${vbH}`}
      fill="currentColor"
      width={width}
      height={height}
      className={cn("inline-block shrink-0", className)}
      role="img"
      aria-label="TradingView"
    >
      <title>TradingView</title>
      {/* Left: single smooth “pulse” / chart bump */}
      <path d="M 0.9 14.1 C 0.9 14.1, 3.2 2.6, 8.4 2.6 C 13.2 2.6, 15.4 11.8, 15.4 14.1 L 15.4 15.85 L 0.9 15.85 Z" />
      {/* Middle: dot */}
      <circle cx="20.25" cy="9.35" r="2.35" />
      {/* Right: top-right corner bracket (horizontal + vertical arm) */}
      <rect x="25.35" y="2.15" width="20.75" height="3.45" rx="0.55" />
      <rect x="42.65" y="2.15" width="3.45" height="14.9" rx="0.55" />
    </svg>
  );
}
