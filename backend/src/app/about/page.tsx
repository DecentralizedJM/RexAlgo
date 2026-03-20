import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function AboutPage() {
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
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-4xl font-bold mb-4">About RexAlgo</h1>
        <p className="text-lg text-muted-foreground mb-12">
          Systematic crypto trading infrastructure, powered by the Mudrex Futures API.
        </p>

        <div className="space-y-12">
          <section>
            <h2 className="text-2xl font-semibold mb-4">What We Do</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              RexAlgo is a platform that connects traders with algorithmic strategies
              and copy trading opportunities on Mudrex. We provide the infrastructure
              for strategy discovery, subscription, and execution — all through your
              own Mudrex API connection.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Whether you want to follow experienced traders through copy trading or
              subscribe to systematic algo strategies, RexAlgo handles the execution
              while you maintain full control and custody of your funds.
            </p>
          </section>

          <Separator />

          <section>
            <h2 className="text-2xl font-semibold mb-6">How It Works</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="bg-card/50 border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">Copy Trading</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>Top traders publish their strategies on RexAlgo. You browse their track record, risk profile, and trading style.</p>
                  <p>When you subscribe, you set your own margin per trade. When the strategy creator executes a trade, the same signal can be applied to your account via the Mudrex API.</p>
                </CardContent>
              </Card>

              <Card className="bg-card/50 border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">Algo Strategies</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>Rule-based strategies that trade programmatically. Each strategy has defined parameters — symbol, leverage, stop-loss, take-profit, and timeframe.</p>
                  <p>Subscribe with your preferred margin per trade. The algo executes trades on your Mudrex account according to its defined rules.</p>
                </CardContent>
              </Card>
            </div>
          </section>

          <Separator />

          <section>
            <h2 className="text-2xl font-semibold mb-6">Our Principles</h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {[
                {
                  title: "Non-Custodial",
                  description: "Your funds stay on Mudrex. We only execute trades through your API key. Revoke access anytime.",
                },
                {
                  title: "Transparent",
                  description: "Strategy rules and risk parameters are documented. No black boxes. Full trade history available.",
                },
                {
                  title: "User-Controlled",
                  description: "You set your margin per trade, choose your strategies, and maintain full control of your account.",
                },
              ].map((p) => (
                <div key={p.title}>
                  <h3 className="font-semibold mb-2">{p.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h2 className="text-2xl font-semibold mb-4">Mudrex Integration</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              RexAlgo is built on top of the{" "}
              <a
                href="https://docs.trade.mudrex.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Mudrex Futures Trading API
              </a>
              . This gives you access to 500+ trading pairs, up to 125x leverage,
              and sub-second order execution.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              To use RexAlgo, you need a Mudrex account with API access enabled.
              Complete KYC, enable 2FA, and generate your API key from the Mudrex dashboard.
            </p>
          </section>

          <Separator />

          <section className="bg-card/50 rounded-lg border border-border/50 p-6">
            <h2 className="text-lg font-semibold mb-3">Risk Disclaimer</h2>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Cryptocurrency futures trading involves significant risk of loss and is not suitable
                for all investors. The high degree of leverage can work against you as well as for you.
              </p>
              <p>
                Past performance of any strategy is not indicative of future results. You should
                carefully consider whether trading is appropriate given your financial situation.
              </p>
              <p className="font-medium text-foreground/80">
                Only invest what you can afford to lose. RexAlgo is not a financial advisor.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
