/**
 * Settings: account-level controls that should not live in the main navbar.
 *
 * Kept narrow on purpose — this page only covers account-level preferences
 * that don't fit on the dashboard or auth screen. Strategy settings live in
 * the respective studios.
 */
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BellOff,
  BellRing,
  Copy,
  LifeBuoy,
  Loader2,
  Mail,
  PowerOff,
  SunMoon,
  Unlink,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import { useRequireAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { TelegramLoginButton } from "@/components/TelegramLoginButton";
import {
  ApiError,
  activateKillSwitch,
  setTelegramNotifyEnabled,
  unlinkTelegram,
} from "@/lib/api";
import { refreshAppData } from "@/lib/refreshAppData";
import { MUDREX_KEY_PROBE_QUERY_KEY } from "@/lib/queryKeys";
import { toast } from "sonner";

const SUPPORT_EMAIL = "help@rexalgo.xyz";

function AppearanceCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SunMoon className="h-4 w-4 text-primary" aria-hidden />
          Appearance
        </CardTitle>
        <CardDescription>
          Choose the theme RexAlgo uses on this browser.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Light / dark mode</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Switch between the focused dark trading view and a lighter account view.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </CardContent>
    </Card>
  );
}

function SupportCard() {
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      toast.success("Support email copied");
    } catch {
      toast.error("Could not copy support email");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-primary" aria-hidden />
          Support
        </CardTitle>
        <CardDescription>
          Need help with your RexAlgo account, subscriptions, or Mudrex connection?
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Email support</p>
          <p className="mt-1 font-mono text-sm text-foreground">{SUPPORT_EMAIL}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Include your account email and what you were trying to do.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="hero" asChild>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=RexAlgo%20support`}>
              <Mail className="h-4 w-4" />
              Email support
            </a>
          </Button>
          <Button type="button" variant="outline" onClick={() => void copyEmail()}>
            <Copy className="h-4 w-4" />
            Copy email
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function KillSwitchCard({ hasMudrexKey }: { hasMudrexKey: boolean }) {
  const queryClient = useQueryClient();

  const killSwitchMut = useMutation({
    mutationFn: activateKillSwitch,
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["session", "me"] }),
        queryClient.invalidateQueries({ queryKey: MUDREX_KEY_PROBE_QUERY_KEY }),
        refreshAppData(queryClient),
      ]);

      const { summary } = data;
      const base =
        `Stopped ${summary.subscriptionsStopped} subscription` +
        `${summary.subscriptionsStopped === 1 ? "" : "s"}, ` +
        `cancelled ${summary.ordersCancelled} order` +
        `${summary.ordersCancelled === 1 ? "" : "s"}, and closed ` +
        `${summary.positionsClosed} RexAlgo position` +
        `${summary.positionsClosed === 1 ? "" : "s"}.`;

      if (summary.failures > 0) {
        toast.warning(`${base} ${summary.failures} item(s) need manual review.`);
      } else {
        toast.success(`Kill switch activated. ${base}`);
      }
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Kill switch failed");
    },
  });

  return (
    <Card className="border-loss/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-loss">
          <PowerOff className="h-4 w-4" aria-hidden />
          Kill switch
        </CardTitle>
        <CardDescription>
          Emergency stop for RexAlgo automation on this account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-loss/30 bg-loss/5 p-4">
          <p className="text-sm font-medium text-foreground">
            Activating this will stop future RexAlgo automation.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>Stops all active algo and copy-trading subscriptions.</li>
            <li>Attempts to cancel open RexAlgo-created Mudrex orders.</li>
            <li>Attempts to close currently open Mudrex positions created by RexAlgo.</li>
            <li>Disconnects the stored Mudrex API key from RexAlgo.</li>
            <li>Does not intentionally close positions you opened directly on Mudrex.</li>
          </ul>
          {!hasMudrexKey && (
            <p className="mt-3 text-xs text-muted-foreground">
              No Mudrex key is currently connected, so RexAlgo can only stop local subscriptions.
            </p>
          )}
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="destructive"
              disabled={killSwitchMut.isPending}
            >
              {killSwitchMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PowerOff className="h-4 w-4" />
              )}
              Activate kill switch
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Activate kill switch?</AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <span className="block">
                  RexAlgo will stop all active strategy and copy-trading subscriptions, then disconnect your stored
                  Mudrex API key.
                </span>
                <span className="block">
                  Before disconnecting the key, RexAlgo will try to cancel open orders and close open positions it
                  created. Positions opened directly on Mudrex are not targeted.
                </span>
                <span className="block text-foreground/90">
                  If Mudrex rejects any close or cancel request, RexAlgo will report it and leave that item for manual
                  review in Mudrex.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={killSwitchMut.isPending}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={killSwitchMut.isPending}
                onClick={() => killSwitchMut.mutate()}
              >
                {killSwitchMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PowerOff className="h-4 w-4" />
                )}
                Yes, activate kill switch
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

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
    toast.success("Telegram linked. You will get trade and alert DMs here.");
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
            Control account preferences, support, and emergency trading controls.
          </p>
        </div>

        <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Telegram</CardTitle>
            <CardDescription>
              Link Telegram for trade confirmations, PnL and risk alerts, and admin updates as DMs. Sign-in stays
              Google-only.
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
                    Alerts and notifications use this chat. Your account email stays the one from Google sign-in.
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
                  Connect Telegram to get real-time trade, PnL, and liquidation-risk alerts in this chat.
                </p>
                <div className="flex justify-start">
                  <TelegramLoginButton
                    mode="link"
                    layout="card"
                    afterAuthReturnPath="/settings"
                    onLinked={handleTelegramLinked}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <AppearanceCard />
        <SupportCard />
        <KillSwitchCard hasMudrexKey={Boolean(user.hasMudrexKey)} />
        </div>
      </div>
    </div>
  );
}
