import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Users,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  BookmarkCheck,
  LifeBuoy,
  RefreshCw,
  KeyRound,
  ExternalLink,
  ChevronDown,
  Check,
  UserCog,
} from "lucide-react";
import { useState, useRef, useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "@/hooks/useAuth";
import { logout } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { RexAlgoWordmark } from "@/components/RexAlgoWordmark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { refreshAppData } from "@/lib/refreshAppData";
import { toast } from "sonner";
import { useMudrexKeyInvalid } from "@/contexts/MudrexKeyInvalidContext";
import { MUDREX_PRO_TRADING_URL } from "@/lib/externalLinks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const navRef = useRef<HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const isLanding = location.pathname === "/";
  const { data: session } = useSession();
  const user = session?.user;
  const { mudrexKeyInvalid } = useMudrexKeyInvalid();
  const showMudrexKeyBanner =
    Boolean(user) && mudrexKeyInvalid && location.pathname !== "/auth";
  const onStrategyStudio = location.pathname.startsWith("/marketplace/studio");
  const onCopyStudio = location.pathname.startsWith("/copy-trading/studio");
  const studioActive = onStrategyStudio || onCopyStudio;

  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      document.documentElement.style.setProperty("--app-nav-offset", "4rem");
      return;
    }
    const apply = () => {
      document.documentElement.style.setProperty(
        "--app-nav-offset",
        `${el.offsetHeight}px`
      );
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [showMudrexKeyBanner, mobileOpen]);

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
    } catch {
      toast.error("Could not refresh");
    } finally {
      setRefreshing(false);
      setMobileOpen(false);
    }
  }

  return (
    <nav ref={navRef} className="fixed top-0 left-0 right-0 z-50 glass flex flex-col">
      <div className="container mx-auto flex h-16 shrink-0 items-center gap-4 px-4 md:gap-6 lg:gap-8">
        <Link to="/" className="group flex shrink-0 items-center gap-2">
          <RexAlgoLogo size={32} className="rounded-lg" />
          <RexAlgoWordmark className="text-lg" />
        </Link>

        <div className="hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                    studioActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  }`}
                  aria-label="Master studio navigation"
                >
                  <UserCog className="h-4 w-4" aria-hidden />
                  Master studio
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-44">
                <DropdownMenuItem
                  className={`flex items-center justify-between ${
                    onStrategyStudio ? "bg-secondary text-foreground" : ""
                  }`}
                  onSelect={() => navigate("/marketplace/studio")}
                >
                  Strategy
                  {onStrategyStudio && <Check className="h-4 w-4" aria-hidden />}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={`flex items-center justify-between ${
                    onCopyStudio ? "bg-secondary text-foreground" : ""
                  }`}
                  onSelect={() => navigate("/copy-trading/studio")}
                >
                  Copy trading
                  {onCopyStudio && <Check className="h-4 w-4" aria-hidden />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none md:gap-3">
          <div className="hidden items-center gap-2 md:flex md:gap-3">
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
              <TooltipContent side="bottom">Pull latest from Mudrex</TooltipContent>
            </Tooltip>
          )}
          {isLanding && !user ? (
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
            <div className="hidden md:flex flex-col items-end">
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
              <span
                className="mt-1 max-w-[160px] truncate text-[11px] text-muted-foreground"
                title={user.email || user.displayName}
              >
                {user.email || user.displayName}
              </span>
            </div>
          ) : (
            <Link to="/auth">
              <Button variant="hero" size="sm">
                Sign in
              </Button>
            </Link>
          )}
          </div>

        <button
          type="button"
          className="p-2 text-muted-foreground hover:text-foreground md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        </div>
      </div>

      {showMudrexKeyBanner && (
        <div className="border-t border-loss/35 bg-loss/10 px-4 py-2.5 shrink-0">
          <div className="container mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 text-sm">
            <div className="flex gap-2 items-start min-w-0">
              <KeyRound className="w-4 h-4 text-loss shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium text-loss">Rotate your Mudrex API key</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Mudrex rejected the key we have on file (expired or revoked).{" "}
                  <a
                    href={MUDREX_PRO_TRADING_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary font-medium underline-offset-2 hover:underline inline-flex items-center gap-1"
                  >
                    Open Mudrex for your API Secret
                    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
                  </a>{" "}
                  to generate or rotate your API key, then sign in here again.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full sm:w-auto"
                asChild
              >
                <a
                  href={MUDREX_PRO_TRADING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileOpen(false)}
                >
                  <ExternalLink className="w-4 h-4" />
                  Mudrex: keys &amp; API
                </a>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 border-loss/45 w-full sm:w-auto"
                onClick={() => {
                  navigate("/auth", { state: { from: location.pathname } });
                  setMobileOpen(false);
                }}
              >
                <KeyRound className="w-4 h-4" />
                Rotate key & sign in
              </Button>
            </div>
          </div>
        </div>
      )}

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
              <div className="rounded-lg border border-border/60 p-2">
                <p className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted-foreground">
                  <UserCog className="h-3.5 w-3.5" aria-hidden />
                  Master studio
                </p>
                <Link
                  to="/marketplace/studio"
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    onStrategyStudio
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Strategy
                  {onStrategyStudio && <Check className="h-4 w-4" aria-hidden />}
                </Link>
                <Link
                  to="/copy-trading/studio"
                  onClick={() => setMobileOpen(false)}
                  className={`mt-1 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    onCopyStudio
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Copy trading
                  {onCopyStudio && <Check className="h-4 w-4" aria-hidden />}
                </Link>
              </div>
            )}
            <Link to="/about" onClick={() => setMobileOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start">
                About
              </Button>
            </Link>
            {user ? (
              <div className="space-y-1.5">
                <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
                  <LogOut className="w-4 h-4" />
                  Sign out
                </Button>
                <p className="px-1 text-xs text-muted-foreground">{user.email || user.displayName}</p>
              </div>
            ) : (
              <Link to="/auth" onClick={() => setMobileOpen(false)}>
                <Button variant="hero" size="sm" className="w-full">
                  Sign in
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
