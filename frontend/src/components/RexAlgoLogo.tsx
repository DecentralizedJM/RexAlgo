import { cn } from "@/lib/utils";

type RexAlgoLogoProps = {
  className?: string;
  /** Square size in px */
  size?: number;
};

/**
 * RexAlgo mark — bundled SVG in `public/rexalgo-mark.svg` (served at site root).
 * Uses explicit pixel box + inline sizing so flex/nav CSS cannot squash the asset
 * (the old `/rexalgo-logo.png` was never shipped in the repo, so the image 404’d).
 */
export function RexAlgoLogo({ className, size = 32 }: RexAlgoLogoProps) {
  const px = `${size}px`;
  return (
    <img
      src="/rexalgo-mark.svg"
      alt="RexAlgo"
      width={size}
      height={size}
      decoding="async"
      draggable={false}
      className={cn(
        "block shrink-0 max-w-none select-none object-contain rounded-lg",
        className
      )}
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
