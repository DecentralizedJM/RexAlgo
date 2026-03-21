import { cn } from "@/lib/utils";

type RexAlgoLogoProps = {
  className?: string;
  /** Square size in px */
  size?: number;
};

/** RexAlgo mark (`/rexalgo-logo.png`). */
export function RexAlgoLogo({ className, size = 32 }: RexAlgoLogoProps) {
  return (
    <img
      src="/rexalgo-logo.png"
      alt="RexAlgo"
      width={size}
      height={size}
      className={cn(
        "object-contain rounded-md ring-1 ring-border/50 bg-card/80 shrink-0",
        className
      )}
    />
  );
}
