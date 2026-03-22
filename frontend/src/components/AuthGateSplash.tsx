import { Loader2 } from "lucide-react";

/** Shown while /api/auth/me is resolving so protected routes don’t flash real content. */
export function AuthGateSplash() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      aria-busy="true"
      aria-label="Checking sign-in"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
