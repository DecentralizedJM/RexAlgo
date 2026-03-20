import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { TrendingUp, Shield, Zap, BarChart3, ArrowRight, Users, Bot } from "lucide-react";
import Navbar from "@/components/Navbar";

const stats = [
  { label: "Trading Volume", value: "$2.4B+" },
  { label: "Active Traders", value: "34,200+" },
  { label: "Avg. ROI", value: "47.2%" },
  { label: "Strategies", value: "850+" },
];

const features = [
  {
    icon: Bot,
    title: "Algo Strategies",
    description: "Access battle-tested algorithms that trade 24/7 across multiple crypto pairs.",
  },
  {
    icon: Users,
    title: "Copy Trading",
    description: "Mirror the trades of top performers. One click to replicate proven strategies.",
  },
  {
    icon: Shield,
    title: "Risk Management",
    description: "Configurable stop-losses, position sizing, and drawdown limits built into every strategy.",
  },
  {
    icon: Zap,
    title: "Instant Execution",
    description: "Sub-millisecond order routing. Your strategies execute before the market moves.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-6">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-medium text-primary">Live Trading Active</span>
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.08] mb-6 animate-fade-up-delay-1" style={{ textWrap: "balance" }}>
            Algorithmic crypto trading,{" "}
            <span className="text-primary">simplified</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 animate-fade-up-delay-2" style={{ textWrap: "pretty" }}>
            Deploy proven strategies, copy top traders, and manage risk — all from one clean interface. No coding required.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-up-delay-3">
            <Link to="/auth">
              <Button variant="hero" size="lg">
                Start Trading
                <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
            <Link to="/marketplace">
              <Button variant="outline" size="lg">
                <BarChart3 className="w-5 h-5" />
                Explore Strategies
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-y border-border">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <div key={stat.label} className="text-center animate-fade-up" style={{ animationDelay: `${i * 80}ms` }}>
                <p className="text-2xl md:text-3xl font-mono font-bold text-foreground">{stat.value}</p>
                <p className="text-sm text-muted-foreground mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16 animate-fade-up">
            <h2 className="text-3xl font-bold mb-4">Everything you need to trade smarter</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Professional-grade tools wrapped in an interface anyone can use.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="glass rounded-xl p-8 hover:border-primary/20 transition-all duration-300 animate-fade-up"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="glass rounded-2xl p-12 animate-pulse-glow">
            <TrendingUp className="w-10 h-10 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-3">Ready to automate your trading?</h2>
            <p className="text-muted-foreground mb-8">
              Connect your exchange API and start running strategies in under 2 minutes.
            </p>
            <Link to="/auth">
              <Button variant="hero" size="lg">
                Connect Exchange
                <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold">RexAlgo</span>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 RexAlgo. All rights reserved. Not financial advice.</p>
        </div>
      </footer>
    </div>
  );
}
