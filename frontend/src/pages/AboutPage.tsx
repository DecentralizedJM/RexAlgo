import Navbar from "@/components/Navbar";
import { Shield, Target, Code, Globe } from "lucide-react";

const values = [
  { icon: Shield, title: "Security First", desc: "Your API keys are encrypted locally. We never hold your funds." },
  { icon: Target, title: "Data-Driven", desc: "Every strategy is backtested against 3+ years of market data." },
  { icon: Code, title: "Open Algorithms", desc: "Full transparency on strategy logic, parameters, and trade history." },
  { icon: Globe, title: "Multi-Exchange", desc: "Works with Binance, Bybit, OKX, and more. One interface, all exchanges." },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-28 pb-20 max-w-3xl">
        <div className="animate-fade-up">
          <h1 className="text-4xl font-bold mb-6" style={{ lineHeight: 1.1 }}>About RexAlgo</h1>
          <p className="text-lg text-muted-foreground mb-12 leading-relaxed">
            RexAlgo was built by traders who were tired of clunky interfaces, opaque strategies, and platforms that treat risk as an afterthought. We believe algorithmic trading should be accessible, transparent, and safe.
          </p>
        </div>

        <div className="space-y-6">
          {values.map((v, i) => (
            <div
              key={v.title}
              className="glass rounded-xl p-6 flex items-start gap-4 animate-fade-up"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <v.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">{v.title}</h3>
                <p className="text-sm text-muted-foreground">{v.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
