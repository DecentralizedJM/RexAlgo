/**
 * Settings: account-level controls that should not live in the main navbar.
 *
 * Kept narrow on purpose — this page only covers account-level preferences
 * that don't fit on the dashboard or auth screen. Strategy settings live in
 * the respective studios.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BellOff,
  BellRing,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  linkMudrexKey,
  setTelegramNotifyEnabled,
  unlinkMudrexKey,
  unlinkTelegram,
} from "@/lib/api";
import { refreshAppData } from "@/lib/refreshAppData";
import { MUDREX_KEY_PROBE_QUERY_KEY } from "@/lib/queryKeys";
import { MUDREX_PRO_TRADING_URL } from "@/lib/externalLinks";
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

function MudrexDisclaimer() {
  return (
    <div className="rounded-lg border border-warning/35 bg-warning/10 p-4 flex gap-3">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" aria-hidden />
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Note:</span> Disconnecting your Mudrex API key or changing to a
        new secret may <span className="text-foreground font-medium">temporarily pause</span> copy-trading and
        algorithm subscriptions until you reconnect a valid key. Your RexAlgo subscriptions stay on file; mirrors
        resume once Mudrex accepts the new credentials.
      </p>
    </div>
  );
}

function MudrexApiControlsCard({ hasMudrexKey }: { hasMudrexKey: boolean }) {
  const queryClient = useQueryClient();
  const [changeSecretOpen, setChangeSecretOpen] = useState(false);
  const [newSecret, setNewSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const disconnectMut = useMutation({
    mutationFn: unlinkMudrexKey,
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["session", "me"] }),
        queryClient.invalidateQueries({ queryKey: MUDREX_KEY_PROBE_QUERY_KEY }),
        refreshAppData(queryClient),
      ]);
      toast.success("Mudrex API disconnected from RexAlgo");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Disconnect failed");
    },
  });

  const changeSecretMut = useMutation({
    mutationFn: linkMudrexKey,
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["session", "me"] }),
        queryClient.invalidateQueries({ queryKey: MUDREX_KEY_PROBE_QUERY_KEY }),
        refreshAppData(queryClient),
      ]);
      setChangeSecretOpen(false);
      setNewSecret("");
      toast.success("Mudrex API secret updated");
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : "Could not update API secret");
    },
  });

  const submitNewSecret = () => {
    const s = newSecret.trim();
    if (!s) {
      toast.error("Paste your new Mudrex API secret");
      return;
    }
    changeSecretMut.mutate(s);
  };

  return (
    <div id="mudrex-api" className="scroll-mt-24">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden />
          Mudrex API
        </CardTitle>
        <CardDescription>
          Disconnect or rotate your stored secret without running the kill switch. Use the kill switch only when you
          need to stop subscriptions and unwind RexAlgo positions in one step.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MudrexDisclaimer />

        {!hasMudrexKey ? (
          <p className="text-sm text-muted-foreground">
            No Mudrex API key on file.{" "}
            <Link to="/dashboard" className="text-primary font-medium hover:underline">
              Open the dashboard
            </Link>{" "}
            to connect Mudrex.
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setChangeSecretOpen(true)}>
              <KeyRound className="h-4 w-4 mr-1.5" />
              Change API secret
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="border-loss/40 text-loss hover:bg-loss/10"
                  disabled={disconnectMut.isPending}
                >
                  {disconnectMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Unlink className="h-4 w-4 mr-1.5" />
                  )}
                  Disconnect Mudrex API
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect Mudrex API?</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-3">
                    <span className="block">
                      RexAlgo will remove your stored API secret. Copy-trading and algo mirrors will not run until you
                      connect a key again from the dashboard.
                    </span>
                    <span className="block text-foreground/90 text-sm">
                      This does not cancel subscriptions or close positions by itself. For a full emergency stop,
                      use the kill switch below.
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={disconnectMut.isPending}>Cancel</AlertDialogCancel>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={disconnectMut.isPending}
                    onClick={() => disconnectMut.mutate()}
                  >
                    {disconnectMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Disconnect"
                    )}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        <Dialog
          open={changeSecretOpen}
          onOpenChange={(o) => {
            setChangeSecretOpen(o);
            if (!o) {
              setNewSecret("");
              setShowSecret(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Change API secret</DialogTitle>
              <DialogDescription>
                Paste a new secret from Mudrex. Your previous key stops working on RexAlgo as soon as this succeeds.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <MudrexDisclaimer />
              <div className="space-y-2">
                <Label htmlFor="settings-mudrex-secret">New Mudrex API secret</Label>
                <div className="relative">
                  <Input
                    id="settings-mudrex-secret"
                    type={showSecret ? "text" : "password"}
                    value={newSecret}
                    onChange={(e) => setNewSecret(e.target.value)}
                    placeholder="Paste new API secret"
                    className="pr-10 font-mono text-sm"
                    autoComplete="off"
                    disabled={changeSecretMut.isPending}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                    onClick={() => setShowSecret((v) => !v)}
                    aria-label={showSecret ? "Hide secret" : "Show secret"}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button variant="link" className="h-auto p-0 text-xs" asChild>
                <a href={MUDREX_PRO_TRADING_URL} target="_blank" rel="noopener noreferrer">
                  Open Mudrex to create or copy an API secret
                  <ExternalLink className="inline h-3 w-3 ml-1 opacity-70" aria-hidden />
                </a>
              </Button>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setChangeSecretOpen(false)}
                disabled={changeSecretMut.isPending}
              >
                Cancel
              </Button>
              <Button type="button" variant="hero" onClick={() => submitNewSecret()} disabled={changeSecretMut.isPending}>
                {changeSecretMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save new secret"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
    </div>
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = authQ.data?.user;

  useEffect(() => {
    if (location.hash !== "#mudrex-api") return;
    const el = document.getElementById("mudrex-api");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.pathname, location.hash]);

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
            Telegram, <span className="text-foreground font-medium">Mudrex API</span> (disconnect / rotate key),
            appearance, support, and emergency controls.
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
        <MudrexApiControlsCard hasMudrexKey={Boolean(user.hasMudrexKey)} />
        <AppearanceCard />
        <SupportCard />
        <KillSwitchCard hasMudrexKey={Boolean(user.hasMudrexKey)} />
        </div>
      </div>
    </div>
  );
}
