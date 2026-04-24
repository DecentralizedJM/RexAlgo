import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { RexAlgoWordmark } from "@/components/RexAlgoWordmark";
import { loginWithGoogle, ApiError, type SessionUser } from "@/lib/api";
import { MUDREX_KEY_PROBE_QUERY_KEY } from "@/lib/queryKeys";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";

type AuthState = "idle" | "loading" | "error";

export default function AuthPage() {
  const [state, setState] = useState<AuthState>("idle");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from || "/dashboard";
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const err = searchParams.get("telegram_error");
    if (!err) return;
    setState("error");
    setMessage(err);
    const next = new URLSearchParams(searchParams);
    next.delete("telegram_error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleGoogleSuccess = async (response: CredentialResponse) => {
    if (!response.credential) {
      setState("error");
      setMessage("Google sign-in did not return a credential. Try again.");
      return;
    }

    setState("loading");
    setMessage("");
    try {
      const result = await loginWithGoogle(response.credential);
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
          : "Could not sign in. Please try again."
      );
    }
  };

  const handleGoogleError = () => {
    setState("error");
    setMessage("Google sign-in was cancelled or failed. Please try again.");
  };

  const handleTelegramSignedIn = (user: SessionUser, returnPath: string | null) => {
    // Seed the cache so the app doesn't flash an auth-gate splash on navigate.
    queryClient.setQueryData(["session", "me"], {
      user,
      sessionExpiresAt: null,
    });
    void queryClient.refetchQueries({ queryKey: ["session", "me"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    void queryClient.invalidateQueries({ queryKey: MUDREX_KEY_PROBE_QUERY_KEY });
    navigate(returnPath ?? from, { replace: true });
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Link
        to="/"
        className="absolute left-4 top-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary sm:left-6 sm:top-6"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        Back to home
      </Link>

      <header className="mb-10 flex w-full max-w-md flex-col items-center gap-4 text-center">
        <RexAlgoLogo size={64} className="rounded-2xl shadow-md ring-1 ring-primary/25" />
        <RexAlgoWordmark className="text-4xl sm:text-5xl md:text-6xl leading-none" />
      </header>

      <div className="w-full max-w-md animate-fade-up">
        <div className="glass rounded-2xl p-8">
          <h1 className="text-xl font-bold text-center mb-2">Sign in</h1>
          <p className="text-sm text-muted-foreground text-center mb-8">
            Sign in with your Google account to get started. You can connect your Mudrex API key later.
          </p>

          {state === "error" && (
            <div
              className="flex items-center gap-2 text-loss text-sm bg-loss/10 rounded-lg p-3 mb-6 animate-fade-up"
              style={{ animationDuration: "0.3s" }}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              {message}
            </div>
          )}

          {state === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in...
            </div>
          ) : (
            <div className="flex flex-col items-stretch gap-3">
              {/* Rectangular + outline = clear button (pill + 340px looked like a stretched slider). */}
              <div className="mx-auto w-full max-w-[min(100%,20rem)] rounded-xl border border-border/80 bg-card/50 p-3 shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
                <div className="flex justify-center overflow-hidden rounded-lg">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    theme="outline"
                    size="large"
                    text="continue_with"
                    shape="rectangular"
                    width="284"
                  />
                </div>
              </div>
              <p className="text-center text-[11px] text-muted-foreground/90">
                Secured with Google. We never see your password.
              </p>

              <div className="mx-auto w-full max-w-[min(100%,20rem)]">
                <div className="flex items-center gap-3 my-1 text-[11px] uppercase tracking-wide text-muted-foreground/80">
                  <span className="flex-1 border-t border-border/60" />
                  or
                  <span className="flex-1 border-t border-border/60" />
                </div>
                <TelegramLoginButton
                  afterAuthReturnPath={from}
                  onSignedIn={handleTelegramSignedIn}
                />
                <p className="mt-2 text-center text-[11px] text-muted-foreground/90">
                  One tap — opens Telegram. No phone number, no OTP.
                </p>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center mt-8 leading-relaxed">
            Your identity is tied to your Google email. It stays the same even if you rotate your Mudrex API key.
          </p>
        </div>
      </div>
    </div>
  );
}
