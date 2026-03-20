import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    title: "Non-Custodial",
    description:
      "We never hold your funds. Execution runs via your Mudrex API — capital stays on your exchange.",
    icon: "🔒",
  },
  {
    title: "API-Based Execution",
    description:
      "Strategies execute through read-and-trade API keys you control. Revoke access anytime.",
    icon: "⚡",
  },
  {
    title: "Copy Trading",
    description:
      "Follow top traders and automatically mirror their trades with your own margin settings.",
    icon: "📋",
  },
  {
    title: "Algo Strategies",
    description:
      "Subscribe to rule-based algorithmic strategies. Set your margin and let the system trade.",
    icon: "🤖",
  },
];

const steps = [
  {
    step: "01",
    title: "Connect Exchange API",
    description:
      "Link your Mudrex account via API secret. You retain full control — we never custody funds.",
  },
  {
    step: "02",
    title: "Select a Strategy",
    description:
      "Browse copy traders or algo strategies. Filter by risk level, symbol, and performance.",
  },
  {
    step: "03",
    title: "Set Margin & Execute",
    description:
      "Define your margin per trade and subscribe. The strategy runs against your exchange account.",
  },
];

const showcaseStrategies = [
  {
    name: "BTC Trend Rider",
    symbol: "BTCUSDT",
    risk: "medium" as const,
    timeframe: "1h",
    type: "Algo",
    pnl: "+24.5%",
  },
  {
    name: "ETH Mean Reversion",
    symbol: "ETHUSDT",
    risk: "high" as const,
    timeframe: "15m",
    type: "Algo",
    pnl: "+18.2%",
  },
  {
    name: "SOL Scalper Pro",
    symbol: "SOLUSDT",
    risk: "high" as const,
    timeframe: "5m",
    type: "Copy",
    pnl: "+31.7%",
  },
  {
    name: "XRP Range Trader",
    symbol: "XRPUSDT",
    risk: "low" as const,
    timeframe: "4h",
    type: "Algo",
    pnl: "+12.3%",
  },
];

const riskColors = {
  low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  high: "bg-red-500/10 text-red-400 border-red-500/20",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center font-bold text-primary-foreground text-sm">
              R
            </div>
            <span className="text-xl font-bold">RexAlgo</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <Link href="/about" className="hover:text-foreground transition-colors">
              About
            </Link>
            <a href="#features" className="hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">
              How It Works
            </a>
            <a href="#strategies" className="hover:text-foreground transition-colors">
              Strategies
            </a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-transparent to-transparent" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20 relative">
          <div className="max-w-3xl mx-auto text-center">
            <Badge variant="outline" className="mb-6 text-primary border-primary/30">
              Powered by Mudrex Futures API
            </Badge>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
              Systematic Crypto Trading.{" "}
              <span className="text-primary">Built for You.</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
              Subscribe to algorithmic trading strategies or copy top traders.
              Execute directly on Mudrex with full control. Non-custodial, API-driven,
              and transparent.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/login">
                <Button size="lg" className="text-base px-8">
                  Start Trading
                </Button>
              </Link>
              <a href="#strategies">
                <Button variant="outline" size="lg" className="text-base px-8">
                  Explore Strategies
                </Button>
              </a>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { label: "Trading Pairs", value: "500+" },
              { label: "Max Leverage", value: "125x" },
              { label: "API Uptime", value: "99.9%" },
              { label: "Execution", value: "<50ms" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-primary">
                  {stat.value}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 border-t border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">
              Built for Serious Traders
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Non-custodial, API-driven, and built for execution discipline.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature) => (
              <Card
                key={feature.title}
                className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors"
              >
                <CardHeader>
                  <div className="text-3xl mb-2">{feature.icon}</div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 border-t border-border/40 bg-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Three steps. No custody. Full control.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {steps.map((step) => (
              <div key={step.step} className="relative">
                <div className="text-5xl font-bold text-primary/20 mb-4">
                  {step.step}
                </div>
                <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Strategy Showcase */}
      <section id="strategies" className="py-24 border-t border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Strategy Showcase</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Risk-tagged, timeframe-defined. Browse and subscribe inside the dashboard.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {showcaseStrategies.map((s) => (
              <Card
                key={s.name}
                className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge
                      variant="outline"
                      className={riskColors[s.risk]}
                    >
                      {s.risk}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {s.timeframe}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {s.type}
                    </Badge>
                  </div>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <CardDescription>{s.symbol}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-emerald-400">
                    {s.pnl}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    30-day return (simulated)
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="/login">
              <Button size="lg">View All Strategies</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Risk Disclosure */}
      <section className="py-16 border-t border-border/40 bg-card/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h3 className="text-lg font-semibold mb-4 text-center">
            Risk & Disclosure
          </h3>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Crypto markets are volatile. Capital at risk. Past performance is
              not indicative of future results.
            </p>
            <p>
              Users retain custody of funds. Execution is via your Mudrex API.
              No guaranteed returns. Algorithmic trading involves substantial
              risk.
            </p>
            <p className="font-medium text-foreground/80">
              Only invest what you can afford to lose.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-6 w-6 rounded bg-primary flex items-center justify-center font-bold text-primary-foreground text-xs">
              R
            </div>
            <span>&copy; {new Date().getFullYear()} RexAlgo</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/about" className="hover:text-foreground transition-colors">
              About
            </Link>
            <a
              href="https://docs.trade.mudrex.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Mudrex API Docs
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
