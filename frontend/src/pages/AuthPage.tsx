import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, Eye, EyeOff, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { login, ApiError } from "@/lib/api";

type AuthState = "idle" | "loading" | "success" | "error";

export default function AuthPage() {
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [state, setState] = useState<AuthState>("idle");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from || "/dashboard";

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;

    setState("loading");
    setMessage("");
    try {
      const result = await login(secret.trim(), displayName.trim() || undefined);
      // Avoid race: dashboard used to read a stale cached `{ user: null }` and redirect to /auth
      queryClient.setQueryData(["session", "me"], { user: result.user });
      await queryClient.refetchQueries({ queryKey: ["session", "me"] });
      setState("success");
      navigate(from, { replace: true });
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof ApiError
          ? err.message
          : "Could not connect. Is the API server running on port 3000?"
      );
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">RexAlgo</span>
        </div>

        <div className="glass rounded-2xl p-8">
          <h1 className="text-xl font-bold text-center mb-2">Connect Mudrex</h1>
          <p className="text-sm text-muted-foreground text-center mb-8">
            Use your <strong className="text-foreground">Mudrex API secret</strong> (shown once in the
            Mudrex dashboard). Optional: set a display name for the community.
          </p>

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Display name (optional)</label>
              <Input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setState("idle");
                }}
                placeholder="e.g. AlphaTrader"
                className="bg-secondary/50 border-border"
                disabled={state === "loading" || state === "success"}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Mudrex API secret</label>
              <div className="relative">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={secret}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    setState("idle");
                  }}
                  placeholder="Paste your API secret"
                  className="bg-secondary/50 border-border pr-10"
                  disabled={state === "loading" || state === "success"}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {state === "error" && (
              <div
                className="flex items-center gap-2 text-loss text-sm bg-loss/10 rounded-lg p-3 animate-fade-up"
                style={{ animationDuration: "0.3s" }}
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                {message}
              </div>
            )}

            {state === "success" && (
              <div
                className="flex items-center gap-2 text-profit text-sm bg-profit/10 rounded-lg p-3 animate-fade-up"
                style={{ animationDuration: "0.3s" }}
              >
                <CheckCircle className="w-4 h-4 shrink-0" />
                Connected. Redirecting…
              </div>
            )}

            <Button
              type="submit"
              variant="hero"
              size="lg"
              className="w-full"
              disabled={!secret.trim() || state === "loading" || state === "success"}
            >
              {state === "loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Validating with Mudrex…
                </>
              ) : state === "success" ? (
                <>
                  <CheckCircle className="w-4 h-4" /> Connected
                </>
              ) : (
                "Connect & sign in"
              )}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center mt-6 leading-relaxed">
            Run the backend locally: <code className="text-foreground/80">cd backend && npm run dev</code>
            <br />
            Docs:{" "}
            <a
              href="https://docs.trade.mudrex.com/docs/overview"
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Mudrex API
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
