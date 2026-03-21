import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Users,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  Radio,
  BookmarkCheck,
  Sparkles,
  LifeBuoy,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "@/hooks/useAuth";
import { logout } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { refreshAppData } from "@/lib/refreshAppData";
import { toast } from "sonner";

const SUPPORT_EMAIL = "help@mudrex.com";

const navLinks = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/subscriptions", label: "Subscriptions", icon: BookmarkCheck },
  { to: "/marketplace", label: "Strategies", icon: BarChart3 },
  { to: "/copy-trading", label: "Copy trading", icon: Users },
];

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const isLanding = location.pathname === "/";
  const { data: session } = useSession();
  const user = session?.user;

  async function handleSignOut() {
    try {
      await logout();
    } catch {
      /* ignore */
    }
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    navigate("/");
    setMobileOpen(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshAppData(queryClient);
      toast.success("Data refreshed");
    } catch {
      toast.error("Could not refresh");
    } finally {
      setRefreshing(false);
      setMobileOpen(false);
    }
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/" className="flex items-center gap-2 group">
          <RexAlgoLogo size={32} className="rounded-lg" />
          <span className="text-lg font-bold tracking-tight">RexAlgo</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                location.pathname === link.to
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              <link.icon className="w-4 h-4" />
              {link.label}
            </Link>
          ))}
          {user && (
            <>
              <Link
                to="/marketplace/studio"
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  location.pathname.startsWith("/marketplace/studio")
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <Sparkles className="w-4 h-4" />
                Strategy studio
              </Link>
              <Link
                to="/copy-trading/studio"
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  location.pathname.startsWith("/copy-trading/studio")
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <Radio className="w-4 h-4" />
                Master studio
              </Link>
            </>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 md:gap-3">
          <ThemeToggle />
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=RexAlgo%20support`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                aria-label={`Email ${SUPPORT_EMAIL}`}
              >
                <LifeBuoy className="h-4 w-4" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom">Support: {SUPPORT_EMAIL}</TooltipContent>
          </Tooltip>
          {user && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 h-9 w-9"
                  disabled={refreshing}
                  onClick={() => void handleRefresh()}
                  aria-label="Refresh balances and positions"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh data (Mudrex)</TooltipContent>
            </Tooltip>
          )}
          {isLanding ? (
            <>
              <Link to="/about">
                <Button variant="ghost" size="sm">
                  About
                </Button>
              </Link>
              <Link to="/auth">
                <Button variant="hero" size="sm">
                  Get started
                </Button>
              </Link>
            </>
          ) : user ? (
            <>
              <span className="text-xs text-muted-foreground max-w-[120px] truncate hidden lg:inline">
                {user.displayName}
              </span>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button variant="hero" size="sm">
                Connect API
              </Button>
            </Link>
          )}
        </div>

        <button
          className="md:hidden p-2 text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden glass border-t border-border">
          <div className="container mx-auto px-4 py-4 flex flex-col gap-2">
            <div className="flex items-center justify-between py-2 border-b border-border/60 mb-1">
              <span className="text-xs font-medium text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=RexAlgo%20support`}
              className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen(false)}
            >
              <LifeBuoy className="w-4 h-4" />
              Support ({SUPPORT_EMAIL})
            </a>
            {user && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh data
              </Button>
            )}
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname === link.to
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <link.icon className="w-4 h-4" />
                {link.label}
              </Link>
            ))}
            {user && (
              <>
                <Link
                  to="/marketplace/studio"
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname.startsWith("/marketplace/studio")
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  Strategy studio
                </Link>
                <Link
                  to="/copy-trading/studio"
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname.startsWith("/copy-trading/studio")
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Radio className="w-4 h-4" />
                  Master studio
                </Link>
              </>
            )}
            <Link to="/about" onClick={() => setMobileOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start">
                About
              </Button>
            </Link>
            {user ? (
              <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
            ) : (
              <Link to="/auth" onClick={() => setMobileOpen(false)}>
                <Button variant="hero" size="sm" className="w-full">
                  Connect API
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
