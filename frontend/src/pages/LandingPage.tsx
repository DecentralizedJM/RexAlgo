import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import {
  Shield,
  Zap,
  BarChart3,
  ArrowRight,
  Users,
  Bot,
  LifeBuoy,
  Github,
} from "lucide-react";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { RexAlgoWordmark } from "@/components/RexAlgoWordmark";
import Navbar from "@/components/Navbar";
import BybitLinearTickerStrip from "@/components/BybitLinearTickerStrip";

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
    description: "Automated strategies on crypto futures, listed in one place.",
  },
  {
    icon: Users,
    title: "Copy Trading",
    description: "Subscribe to listings and mirror signals to your own Mudrex account.",
  },
  {
    icon: Shield,
    title: "Risk Controls",
    description: "Stops, sizing, and risk labels per strategy so you know what you’re taking on.",
  },
  {
    icon: Zap,
    title: "Fast path",
    description: "Connect API, pick a strategy, set margin. No extra stack to run.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Live Bybit linear prices — sits under the nav (fills former dead space) */}
      <section
        className="border-b border-border/60 bg-muted/25 pt-[var(--app-nav-offset)] dark:bg-muted/15"
        aria-label="Market ticker"
      >
        <BybitLinearTickerStrip />
      </section>

      {/* Hero */}
      <section className="pb-20 px-4 pt-12 sm:pt-16">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-6">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-medium text-primary">Live Trading Active</span>
            </div>
          </div>

          <h1
            className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6 animate-fade-up-delay-1 leading-[1.08] tracking-tight"
            style={{ textWrap: "balance" }}
          >
            Algorithmic crypto trading, <span className="text-primary">simplified</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 animate-fade-up-delay-2" style={{ textWrap: "pretty" }}>
            Run algos and copy-trading on Mudrex futures from a single UI. No code.
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
              <div
                key={stat.label}
                className="group/stat relative overflow-visible px-3 py-5 pb-2 text-center animate-fade-up rounded-xl"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div
                  className="landing-stat-glow-bar pointer-events-none absolute inset-0 z-0 rounded-xl bg-primary/20 opacity-0 blur-lg transition-opacity duration-500 group-hover/stat:opacity-100"
                  aria-hidden
                />
                <p className="relative z-[1] text-2xl md:text-3xl font-mono font-bold text-foreground">
                  {stat.value}
                </p>
                <p className="relative z-[1] mt-1 text-sm text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16 animate-fade-up">
            <h2 className="text-3xl font-bold mb-4">What you get</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Algos, copy trading, and subs in one flow on top of Mudrex.
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
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-md text-center">
          <div className="glass rounded-xl p-6 sm:p-8 animate-pulse-glow">
            <h2 className="text-xl sm:text-2xl font-bold mb-2">Ready to connect?</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Sign in with your Mudrex API secret and open the dashboard.
            </p>
            <Link to="/auth">
              <Button variant="hero" size="default" className="w-full sm:w-auto">
                Connect Mudrex
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="container mx-auto flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <div className="flex items-center gap-2">
              <RexAlgoLogo size={28} className="rounded-md" />
              <RexAlgoWordmark className="text-sm font-semibold" />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
              <span className="text-[11px] sm:text-xs text-neutral-600 dark:text-neutral-300">
                Developed by
              </span>
              <a
                href="https://github.com/DecentralizedJM"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/85 transition-colors"
                aria-label="Jithin Mohandas on GitHub"
              >
                <Github className="h-4 w-4 shrink-0" aria-hidden />
                Jithin Mohandas
              </a>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 text-center sm:items-end sm:text-right">
            <a
              href="mailto:help@mudrex.com?subject=RexAlgo%20support"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <LifeBuoy className="w-3.5 h-3.5 shrink-0" />
              help@mudrex.com
            </a>
            <p className="text-xs text-muted-foreground">
              © 2026{" "}
              <RexAlgoWordmark className="inline text-xs font-semibold align-baseline" />. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
