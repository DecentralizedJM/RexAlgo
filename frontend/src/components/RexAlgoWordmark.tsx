import { cn } from "@/lib/utils";

type RexAlgoWordmarkProps = {
  className?: string;
};

/** Brand name: Rex (primary green) + Algo (white in dark mode, near-black in light). */
export function RexAlgoWordmark({ className }: RexAlgoWordmarkProps) {
  return (
    <span className={cn("inline-flex items-baseline font-bold tracking-tight", className)}>
      {/* ! on segment colors so parent text-* / muted wrappers can’t flatten the split brand */}
      <span className="!text-primary">Rex</span>
      <span className="!text-neutral-950 dark:!text-white">Algo</span>
    </span>
  );
}
