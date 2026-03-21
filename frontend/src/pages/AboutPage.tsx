import Navbar from "@/components/Navbar";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { Shield, Target, Code, Globe } from "lucide-react";

const values = [
  { icon: Shield, title: "Keys", desc: "API secrets encrypted at rest; used only to talk to Mudrex." },
  { icon: Target, title: "Listings", desc: "Creators publish strategies; subscribers choose margin and risk." },
  { icon: Code, title: "Webhooks", desc: "Studio flows use signed webhooks so bots can post signals safely." },
  { icon: Globe, title: "Mudrex", desc: "Execution and balances live on Mudrex; RexAlgo is the control layer." },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-28 pb-20 max-w-3xl">
        <div className="animate-fade-up">
          <div className="flex items-center gap-3 mb-6">
            <RexAlgoLogo size={48} className="rounded-xl shrink-0" />
            <h1 className="text-4xl font-bold" style={{ lineHeight: 1.1 }}>
              About RexAlgo
            </h1>
          </div>
          <p className="text-lg text-muted-foreground mb-12 leading-relaxed">
            RexAlgo is a front end for Mudrex futures: algos, copy trading, and subscriptions in one place. We
            don’t custody funds; trades stay on your exchange account.
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
