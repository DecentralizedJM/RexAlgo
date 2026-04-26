import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { RexAlgoWordmark } from "@/components/RexAlgoWordmark";
import { Button } from "@/components/ui/button";
import SEOMeta from "@/components/SEOMeta";
import { SITE_URL } from "@/lib/seo";

const NotFound = () => {
  const location = useLocation();
  const canonical = `${SITE_URL}${location.pathname}`;

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <SEOMeta
        title="Page not found — RexAlgo"
        description="This RexAlgo page does not exist. Return to the home page to continue."
        canonical={canonical}
        noindex
      />
      <div className="mb-6 flex flex-col items-center gap-2">
        <RexAlgoLogo size={48} className="rounded-xl" />
        <RexAlgoWordmark className="text-lg" />
      </div>
      <h1 className="mb-2 text-4xl font-bold">404</h1>
      <p className="mb-6 text-xl text-muted-foreground">Page not found</p>
      <Button asChild variant="hero">
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  );
};

export default NotFound;
