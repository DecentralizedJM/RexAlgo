import { cn } from "@/lib/utils";

type RexAlgoLogoProps = {
  className?: string;
  /** Square size in px */
  size?: number;
};

/** RexAlgo mark — gradient “R” with motion lines (`/rexalgo-logo.png`). */
export function RexAlgoLogo({ className, size = 32 }: RexAlgoLogoProps) {
  return (
    <img
      src="/rexalgo-logo.png"
      alt="RexAlgo"
      width={size}
      height={size}
      className={cn("object-contain shrink-0 rounded-lg", className)}
    />
  );
}
