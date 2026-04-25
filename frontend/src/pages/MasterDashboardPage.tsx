import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Send,
  TrendingUp,
  Users,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { AuthGateSplash } from "@/components/AuthGateSplash";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRequireMasterAccess } from "@/hooks/useAuth";
import {
  fetchMasterDashboard,
  type MasterDashboardActivity,
  type MasterDashboardStrategy,
} from "@/lib/api";
import { liveDataQueryOptions } from "@/lib/liveQueryOptions";

function formatUsdt(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return "$0";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function strategyStudioPath(strategy: MasterDashboardStrategy): string {
  return strategy.type === "copy_trading"
    ? "/copy-trading/studio"
    : "/marketplace/studio";
}

function statusClass(status: MasterDashboardStrategy["status"]) {
  if (status === "approved") return "bg-profit/15 text-profit";
  if (status === "rejected") return "bg-loss/15 text-loss";
  return "bg-warning/15 text-warning";
}

function SummaryCard({
  title,
  value,
  caption,
  icon: Icon,
}: {
  title: string;
  value: string;
  caption: string;
  icon: typeof Users;
}) {
  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{title}</CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold text-foreground">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

function StrategyRow({ strategy }: { strategy: MasterDashboardStrategy }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/40 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-foreground">{strategy.name}</h3>
            <Badge variant="outline" className="capitalize">
              {strategy.type.replace("_", " ")}
            </Badge>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(
                strategy.status
              )}`}
            >
              {strategy.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {strategy.symbol} · {strategy.isActive ? "Active" : "Inactive"} · last
            signal {formatRelative(strategy.lastSignalAt)}
          </p>
        </div>
        <Link to={strategyStudioPath(strategy)}>
          <Button variant="outline" size="sm">Open studio</Button>
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Subscribers" value={formatNumber(strategy.activeSubscribers)} />
        <Metric label="Volume" value={formatUsdt(strategy.totalVolumeUsdt)} />
        <Metric label="Signals" value={formatNumber(strategy.totalSignals)} />
        <Metric label="24h signals" value={formatNumber(strategy.signals24h)} />
        <Metric label="24h errors" value={formatNumber(strategy.mirrorErrors24h)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function ActivityItem({ item }: { item: MasterDashboardActivity }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/40 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{item.strategyName}</p>
          <Badge variant="outline">{item.symbol ?? item.strategySymbol}</Badge>
          {item.action && (
            <Badge className="capitalize" variant="secondary">
              {item.action}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {item.side ?? "Signal"} · {item.triggerType ?? "webhook"} ·{" "}
          {formatRelative(item.receivedAt)}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          Idempotency: {item.idempotencyKey}
        </p>
      </div>
      <div className="grid min-w-[180px] grid-cols-3 gap-2 text-center text-xs">
        <Metric label="Processed" value={formatNumber(item.processed)} />
        <Metric label="OK" value={formatNumber(item.ok)} />
        <Metric label="Errors" value={formatNumber(item.errors)} />
      </div>
    </div>
  );
}

export default function MasterDashboardPage() {
  const authQ = useRequireMasterAccess();
  const sessionAuthed = authQ.authed && authQ.masterApproved;

  const dashboardQ = useQuery({
    queryKey: ["master-dashboard"],
    queryFn: fetchMasterDashboard,
    enabled: sessionAuthed,
    ...liveDataQueryOptions,
  });

  if (!authQ.authResolved) return <AuthGateSplash label="Checking access" />;
  if (!authQ.data?.user) return null;

  const data = dashboardQ.data;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="main-nav-pad container mx-auto px-4 pb-12">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Master Studio</p>
            <h1 className="mt-1 text-3xl font-bold text-foreground">
              Master dashboard
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              View aggregate subscribers, generated volume, and recent signal
              delivery. Subscriber names, emails, phone numbers, and Telegram
              identities are never shown here.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void dashboardQ.refetch()}
            disabled={dashboardQ.isFetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${dashboardQ.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {dashboardQ.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="h-32 animate-pulse bg-card/60" />
            ))}
          </div>
        ) : dashboardQ.isError ? (
          <Card className="border-loss/40 bg-loss/5">
            <CardHeader>
              <CardTitle>Could not load dashboard</CardTitle>
              <CardDescription>
                Please refresh, or confirm your Master Studio access is still approved.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : data ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                title="Active subscribers"
                value={formatNumber(data.summary.activeSubscribers)}
                caption="Across your active subscriptions"
                icon={Users}
              />
              <SummaryCard
                title="Generated volume"
                value={formatUsdt(data.summary.totalVolumeUsdt)}
                caption="Forward-looking ledger total"
                icon={TrendingUp}
              />
              <SummaryCard
                title="Approved active strategies"
                value={formatNumber(data.summary.activeApprovedStrategies)}
                caption={`${formatNumber(data.summary.totalStrategies)} total listings`}
                icon={CheckCircle2}
              />
              <SummaryCard
                title="24h signal errors"
                value={formatNumber(data.summary.recentMirrorErrors24h)}
                caption={`${formatNumber(data.summary.recentSignals24h)} signals received`}
                icon={AlertTriangle}
              />
            </div>

            <Card className="border-border/70 bg-card/80">
              <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>Telegram delivery</CardTitle>
                  <CardDescription>
                    Transactional copy-signal summaries are sent when Telegram is
                    connected and notifications are enabled.
                  </CardDescription>
                </div>
                <Badge
                  className={
                    data.telegram.connected && data.telegram.notifyEnabled
                      ? "bg-profit/15 text-profit"
                      : "bg-warning/15 text-warning"
                  }
                >
                  <Bell className="mr-1.5 h-3.5 w-3.5" />
                  {data.telegram.connected && data.telegram.notifyEnabled
                    ? "Subscribed"
                    : "Setup needed"}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {data.telegram.connected
                    ? `Connected${data.telegram.username ? ` as @${data.telegram.username}` : ""}.`
                    : "Connect Telegram to receive alert and transaction summaries."}
                </p>
                <Link to="/settings">
                  <Button variant="outline" size="sm">
                    <Bot className="mr-2 h-4 w-4" />
                    Telegram settings
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/80">
              <CardHeader>
                <CardTitle>Strategy performance</CardTitle>
                <CardDescription>
                  Aggregated by strategy or copy-trading listing. No subscriber PII is exposed.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.strategies.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-8 text-center">
                    <Activity className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-3 font-medium text-foreground">No master listings yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Create a strategy or copy-trading listing to start tracking aggregate performance.
                    </p>
                  </div>
                ) : (
                  data.strategies.map((strategy) => (
                    <StrategyRow key={strategy.id} strategy={strategy} />
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/80">
              <CardHeader>
                <CardTitle>Recent signal activity</CardTitle>
                <CardDescription>
                  Accepted signal deliveries with aggregate mirror results only.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.recentActivity.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-8 text-center">
                    <Send className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-3 font-medium text-foreground">No signals yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Recent signed webhook activity will appear here after your first accepted signal.
                    </p>
                  </div>
                ) : (
                  data.recentActivity.map((item) => (
                    <ActivityItem key={item.signalId} item={item} />
                  ))
                )}
              </CardContent>
            </Card>

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              Volume is based on RexAlgo ledger entries captured after ledger rollout.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
