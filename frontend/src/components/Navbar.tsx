import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Users,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  BookmarkCheck,
  KeyRound,
  ExternalLink,
  ChevronDown,
  Check,
  UserCog,
  ShieldCheck,
  Settings,
} from "lucide-react";
import { useState, useRef, useLayoutEffect, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "@/hooks/useAuth";
import { logout } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { RexAlgoWordmark } from "@/components/RexAlgoWordmark";
import { TradingViewMark } from "@/components/TradingViewMark";
import { toast } from "sonner";
import { useMudrexKeyInvalid } from "@/contexts/MudrexKeyInvalidContext";
import { MUDREX_PRO_TRADING_URL } from "@/lib/externalLinks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavIcon = ComponentType<{ className?: string }>;

const TvIcon: NavIcon = ({ className }) => (
  <TradingViewMark className={className} height={16} />
);

const navLinks: Array<{
  to: string;
  label: string;
  icon: NavIcon;
  /** Icon supplies its own width/height (wide marks); skip square w-4 h-4 wrapper. */
  intrinsicIcon?: boolean;
}> = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/subscriptions", label: "Subscriptions", icon: BookmarkCheck },
  { to: "/marketplace", label: "Strategies", icon: BarChart3 },
  { to: "/copy-trading", label: "Copy trading", icon: Users },
  { to: "/tv-webhooks", label: "Webhooks", icon: TvIcon, intrinsicIcon: true },
];

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const navRef = useRef<HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isLanding = location.pathname === "/";
  const { data: session } = useSession();
  const user = session?.user;
  const { mudrexKeyInvalid } = useMudrexKeyInvalid();
  const showMudrexKeyBanner =
    Boolean(user) && mudrexKeyInvalid && location.pathname !== "/auth";
  const onMasterDashboard = location.pathname.startsWith("/master-studio/dashboard");
  const onStrategyStudio = location.pathname.startsWith("/marketplace/studio");
  const onCopyStudio = location.pathname.startsWith("/copy-trading/studio");
  const onMasterAccessRequest = location.pathname.startsWith(
    "/master-studio/request"
  );
  const studioActive =
    onMasterDashboard || onStrategyStudio || onCopyStudio || onMasterAccessRequest;
  const masterApproved = user?.masterAccess === "approved" || user?.isAdmin === true;

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
      toast.error("Sign out failed. Check your connection and try again.");
      return;
    }
    queryClient.setQueryData(["session", "me"], {
      user: null,
      sessionExpiresAt: null,
    });
    await queryClient.invalidateQueries({ queryKey: ["session", "me"] });
    navigate("/");
    setMobileOpen(false);
  }

  return (
    <nav ref={navRef} className="fixed top-0 left-0 right-0 z-50 glass flex flex-col">
      <div className="container mx-auto flex h-16 shrink-0 items-center gap-2 px-page sm:gap-4 md:gap-6 lg:gap-8">
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
              <link.icon
                className={
                  link.intrinsicIcon ? "shrink-0 text-current" : "w-4 h-4"
                }
              />
              {link.label}
            </Link>
          ))}
          {user && masterApproved && (
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
                <DropdownMenuItem
                  className={`flex items-center justify-between ${
                    onMasterDashboard ? "bg-secondary text-foreground" : ""
                  }`}
                  onSelect={() => navigate("/master-studio/dashboard")}
                >
                  Dashboard
                  {onMasterDashboard && <Check className="h-4 w-4" aria-hidden />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {user && !masterApproved && (
            <button
              type="button"
              onClick={() => navigate("/master-studio/request")}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                onMasterAccessRequest
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              }`}
              aria-label="Request master studio access"
            >
              <UserCog className="h-4 w-4" aria-hidden />
              Master studio
              {user.masterAccess === "pending" && (
                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  pending
                </span>
              )}
            </button>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none md:gap-3">
          <div className="hidden items-center gap-2 md:flex md:gap-3">
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
            <div className="hidden md:flex items-center gap-2">
              {user.isAdmin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => navigate("/admin")}
                      aria-label="Admin dashboard"
                    >
                      <ShieldCheck className="h-4 w-4" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Admin dashboard</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => navigate("/settings")}
                    aria-label="Account settings"
                  >
                    <Settings className="h-4 w-4" aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Account settings</TooltipContent>
              </Tooltip>
              <div className="flex flex-col items-end">
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
        <div className="border-t border-loss/35 bg-loss/10 px-page py-2.5 shrink-0">
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
          <div className="container mx-auto flex flex-col gap-2 px-page py-4">
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
                <link.icon
                  className={
                    link.intrinsicIcon ? "shrink-0 text-current" : "w-4 h-4"
                  }
                />
                {link.label}
              </Link>
            ))}
            {user && masterApproved && (
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
                <Link
                  to="/master-studio/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className={`mt-1 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    onMasterDashboard
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Dashboard
                  {onMasterDashboard && <Check className="h-4 w-4" aria-hidden />}
                </Link>
              </div>
            )}
            {user && !masterApproved && (
              <Link
                to="/master-studio/request"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                  onMasterAccessRequest
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="flex items-center gap-2">
                  <UserCog className="h-4 w-4" aria-hidden />
                  Master studio
                </span>
                {user.masterAccess === "pending" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                    pending
                  </span>
                )}
              </Link>
            )}
            <Link to="/about" onClick={() => setMobileOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start">
                About
              </Button>
            </Link>
            {user ? (
              <div className="space-y-1.5">
                {user.isAdmin && (
                  <Link
                    to="/admin"
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                      location.pathname === "/admin"
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Admin
                  </Link>
                )}
                <Link
                  to="/settings"
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                    location.pathname === "/settings"
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
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
