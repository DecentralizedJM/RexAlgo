import { Link } from "react-router-dom";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";

/** Not wired in `App` routes; RexAlgo-branded stub if referenced. */
export default function Index() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-page">
      <RexAlgoLogo size={64} className="rounded-xl" />
      <p className="text-sm text-muted-foreground">Open the home page to use RexAlgo.</p>
      <Link to="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Go to RexAlgo
      </Link>
    </div>
  );
}
