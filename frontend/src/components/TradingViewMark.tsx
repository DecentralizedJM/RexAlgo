import { cn } from "@/lib/utils";

/**
 * TradingView-style monogram: corner bracket + dot + slanted bar (wide mark).
 * Wrapped + inline sizes so ancestor rules like `[&_svg]:size-4` cannot squash it.
 * `currentColor` matches surrounding text. Use only where you have trademark permission.
 */
export function TradingViewMark({
  className,
  height = 16,
}: {
  className?: string;
  /** Renders at this height (px); width follows the mark’s intrinsic aspect ratio. */
  height?: number;
}) {
  const vbW = 80;
  const vbH = 26;
  const width = (height * vbW) / vbH;

  const boxStyle = {
    width: `${width}px`,
    height: `${height}px`,
    minWidth: `${width}px`,
    maxWidth: "none" as const,
    flexShrink: 0 as const,
  };

  return (
    <span
      className={cn("inline-flex shrink-0 items-center align-middle", className)}
      style={boxStyle}
      role="img"
      aria-label="TradingView"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${vbW} ${vbH}`}
        fill="currentColor"
        preserveAspectRatio="xMidYMid meet"
        className="block max-w-none"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          maxWidth: "none",
          flexShrink: 0,
          display: "block",
        }}
        aria-hidden
      >
        <title>TradingView</title>
        {/* Left: top-right corner bracket (┐), sharp */}
        <rect x="4" y="5" width="22" height="4.5" />
        <rect x="21.5" y="5" width="4.5" height="17" />
        {/* Center dot */}
        <circle cx="36" cy="13.25" r="3.35" />
        {/* Right: slanted bar (parallelogram) */}
        <polygon points="44,5.5 72,5.5 76,21 48,21" />
      </svg>
    </span>
  );
}
