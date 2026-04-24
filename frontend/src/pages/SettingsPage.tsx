/**
 * Settings: Telegram linking + notification toggle (Phase 6).
 *
 * Kept narrow on purpose — this page only covers account-level preferences
 * that don't fit on the dashboard or auth screen. Mudrex key rotation lives on
 * the auth flow; strategy settings live in the respective studios.
 */
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, BellOff, BellRing, Loader2, Unlink } from "lucide-react";
import Navbar from "@/components/Navbar";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import { useRequireAuth } from "@/hooks/useAuth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";
import {
  ApiError,
  setTelegramNotifyEnabled,
  unlinkTelegram,
} from "@/lib/api";
import { toast } from "sonner";

export default function SettingsPage() {
  const authQ = useRequireAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = authQ.data?.user;

  useEffect(() => {
    // Legacy login-widget query params — still supported so stale tabs don't
    // lose feedback after the deploy swap. New flow surfaces toasts via the
    // component's onLinked callback below.
    const err = searchParams.get("telegram_error");
    const linked = searchParams.get("telegram_linked");
    if (!err && linked !== "1") return;
    const next = new URLSearchParams(searchParams);
    if (err) {
      toast.error(err);
      next.delete("telegram_error");
    }
    if (linked === "1") {
      void queryClient.refetchQueries({ queryKey: ["session", "me"] });
      toast.success("Telegram linked");
      next.delete("telegram_linked");
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, queryClient]);

  const handleTelegramLinked = () => {
    void queryClient.refetchQueries({ queryKey: ["session", "me"] });
    toast.success("Telegram linked — you'll get real-time trade alerts.");
  };

  const unlinkMut = useMutation({
    mutationFn: unlinkTelegram,
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["session", "me"] });
      toast.success("Telegram unlinked");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Unlink failed");
    },
  });

  const toggleMut = useMutation({
    mutationFn: setTelegramNotifyEnabled,
    onSuccess: async (_data, variables) => {
      await queryClient.refetchQueries({ queryKey: ["session", "me"] });
      toast.success(variables ? "Notifications enabled" : "Notifications paused");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Update failed");
    },
  });

  if (!authQ.authResolved) return <AuthGateSplash />;
  if (!user) return null;

  const telegramLinked = Boolean(user.telegramId);
  const notify = user.telegramNotifyEnabled === true;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 main-nav-pad pb-16 max-w-3xl">
        <div className="mb-8">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3"
          >
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold">Account settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control how RexAlgo reaches you outside the app.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Telegram</CardTitle>
            <CardDescription>
              Link your Telegram account to receive trade confirmations and
              admin updates as DMs, and to sign in on other devices.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {telegramLinked ? (
              <>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm font-medium">
                    Linked as{" "}
                    <span className="font-mono">
                      {user.telegramUsername
                        ? `@${user.telegramUsername}`
                        : `tg_${user.telegramId}`}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Signing in with this Telegram account will log you into this
                    same RexAlgo user.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={notify ? "outline" : "hero"}
                    disabled={toggleMut.isPending}
                    onClick={() => toggleMut.mutate(!notify)}
                  >
                    {toggleMut.isPending ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : notify ? (
                      <BellOff className="w-4 h-4 mr-1" />
                    ) : (
                      <BellRing className="w-4 h-4 mr-1" />
                    )}
                    {notify ? "Pause notifications" : "Enable notifications"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-loss hover:text-loss"
                    disabled={unlinkMut.isPending}
                    onClick={() => unlinkMut.mutate()}
                  >
                    <Unlink className="w-4 h-4 mr-1" />
                    Unlink
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  One tap connects your Telegram and unlocks real-time trade,
                  PnL, and liquidation-risk alerts. You can also use Telegram
                  to sign in on other devices.
                </p>
                <div className="flex justify-start">
                  <TelegramLoginButton
                    mode="link"
                    afterAuthReturnPath="/settings"
                    onLinked={handleTelegramLinked}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
