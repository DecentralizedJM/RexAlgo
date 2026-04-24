import { cn } from "@/lib/utils";

type RexAlgoLogoProps = {
  className?: string;
  /** Square size in px */
  size?: number;
};

/**
 * Official RexAlgo mark — `public/rexalgo-mark.png` (square, dark tile + gradient R).
 * Explicit pixel box + inline sizing so flex/nav CSS cannot squash the asset.
 */
export function RexAlgoLogo({ className, size = 32 }: RexAlgoLogoProps) {
  const px = `${size}px`;
  return (
    <img
      src="/rexalgo-mark.png"
      alt="RexAlgo — stylized R with motion lines"
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
