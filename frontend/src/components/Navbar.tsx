import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  TrendingUp,
  BarChart3,
  Users,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  Radio,
  BookmarkCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useAuth";
import { logout } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

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

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary-foreground" />
          </div>
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

        <div className="hidden md:flex items-center gap-3">
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
              <span className="text-xs text-muted-foreground max-w-[140px] truncate">
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
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden glass border-t border-border">
          <div className="container mx-auto px-4 py-4 flex flex-col gap-2">
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
