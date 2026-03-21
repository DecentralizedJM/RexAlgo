import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <RexAlgoLogo size={48} className="mb-6 rounded-xl" />
      <h1 className="mb-2 text-4xl font-bold">404</h1>
      <p className="mb-6 text-xl text-muted-foreground">Page not found</p>
      <Button asChild variant="hero">
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  );
};

export default NotFound;
