import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { login, ApiError } from "@/lib/api";
import { MUDREX_KEY_PROBE_QUERY_KEY } from "@/lib/queryKeys";
import { MUDREX_PRO_TRADING_URL } from "@/lib/externalLinks";

type AuthState = "idle" | "loading" | "error";

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
      queryClient.setQueryData(["session", "me"], {
        user: result.user,
        sessionExpiresAt: null,
      });
      await queryClient.refetchQueries({ queryKey: ["session", "me"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: MUDREX_KEY_PROBE_QUERY_KEY });
      navigate(from, { replace: true });
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof ApiError
          ? err.message
          : "Could not connect. Check your API secret and try again."
      );
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up">
        <div className="flex items-center justify-center gap-2 mb-8">
          <RexAlgoLogo size={40} className="rounded-xl" />
          <span className="text-xl font-bold">RexAlgo</span>
        </div>

        <div className="glass rounded-2xl p-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <img
              src="/mudrex-logo.png"
              alt="Mudrex"
              width={36}
              height={36}
              className="rounded-lg shrink-0"
            />
            <h1 className="text-xl font-bold text-center">Mudrex</h1>
          </div>
          <p className="text-sm text-muted-foreground text-center mb-4">
            Paste your Mudrex API secret (from the Mudrex app). Display name is optional.
          </p>
          <p className="text-center mb-8">
            <a
              href={MUDREX_PRO_TRADING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-2"
            >
              Generate or rotate API key on Mudrex
              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
            </a>
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
                disabled={state === "loading"}
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
                  disabled={state === "loading"}
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

            <Button
              type="submit"
              variant="hero"
              size="lg"
              className="w-full"
              disabled={!secret.trim() || state === "loading"}
            >
              {state === "loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking with Mudrex…
                </>
              ) : (
                "Connect & sign in"
              )}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center mt-6 leading-relaxed">
            Secrets are encrypted at rest and only used to call Mudrex. We never hold your funds; balances
            stay on Mudrex.
          </p>
        </div>
      </div>
    </div>
  );
}
