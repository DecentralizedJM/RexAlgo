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
        "object-contain shrink-0 rounded-xl shadow-sm ring-1 ring-primary/20",
        className
      )}
    />
  );
}
