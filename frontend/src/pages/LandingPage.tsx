import { useMemo, useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
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
  LayoutDashboard,
} from "lucide-react";
import { RexAlgoLogo } from "@/components/RexAlgoLogo";
import { RexAlgoWordmark } from "@/components/RexAlgoWordmark";
import Navbar from "@/components/Navbar";
import BybitLinearTickerStrip from "@/components/BybitLinearTickerStrip";
import { useSession } from "@/hooks/useAuth";

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
    description: "Stops, sizing, and risk labels per strategy so you know what you're taking on.",
  },
  {
    icon: Zap,
    title: "Fast path",
    description: "Connect API, pick a strategy, set margin. No extra stack to run.",
  },
];

const HERO_PRIMARY = "Algorithmic crypto trading, ";
const HERO_ACCENT = "simplified";

const inView = {
  once: true,
  amount: 0.15,
  margin: "0px 0px -8% 0px",
} as const;

function KineticHeroHeadline({ className }: { className?: string }) {
  const primaryChars = Array.from(HERO_PRIMARY);
  const accentChars = Array.from(HERO_ACCENT);
  let waveIndex = 0;

  return (
    <h1 className={`group/kinetic ${className ?? ""}`} aria-label={`${HERO_PRIMARY.trim()} ${HERO_ACCENT}`}>
      <span aria-hidden className="inline-flex flex-wrap justify-center gap-x-[0.03em] gap-y-1 sm:gap-y-0">
        {primaryChars.map((ch, i) => {
          const di = waveIndex++;
          return (
            <span
              key={`p-${i}`}
              className="hero-kinetic-char text-foreground"
              style={{ ["--wave-delay" as string]: `${di * 28}ms` }}
            >
              {ch === " " ? "\u00A0" : ch}
            </span>
          );
        })}
        {accentChars.map((ch, i) => {
          const di = waveIndex++;
          return (
            <span
              key={`a-${i}`}
              className="hero-kinetic-char hero-kinetic-char--accent text-primary"
              style={{ ["--wave-delay" as string]: `${di * 28}ms` }}
            >
              {ch}
            </span>
          );
        })}
      </span>
    </h1>
  );
}

function useRevealVariants() {
  const reduce = useReducedMotion();
  return useMemo(
    () => ({
      section: {
        hidden: { opacity: reduce ? 1 : 0, y: reduce ? 0 : 32 },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: reduce ? 0 : 0.58,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        },
      },
      item: {
        hidden: { opacity: reduce ? 1 : 0, y: reduce ? 0 : 28 },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: reduce ? 0 : 0.52,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        },
      },
      stagger: {
        hidden: {},
        visible: {
          transition: {
            staggerChildren: reduce ? 0 : 0.08,
            delayChildren: reduce ? 0 : 0.06,
          },
        },
      },
      heroChild: {
        hidden: { opacity: reduce ? 1 : 0, y: reduce ? 0 : 24 },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: reduce ? 0 : 0.5,
            ease: [0.16, 1, 0.3, 1] as const,
          },
        },
      },
      heroStagger: {
        hidden: {},
        visible: {
          transition: {
            staggerChildren: reduce ? 0 : 0.1,
            delayChildren: reduce ? 0 : 0.05,
          },
        },
      },
    }),
    [reduce],
  );
}

export default function LandingPage() {
  const { data: session } = useSession();
  const loggedIn = Boolean(session?.user);
  const reduceMotion = useReducedMotion();
  const v = useRevealVariants();

  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });

  const parallaxY = useTransform(
    scrollYProgress,
    [0, 1],
    reduceMotion ? [0, 0] : [0, 72],
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <motion.section
        className="border-b border-border/60 bg-muted/25 pt-[var(--app-nav-offset)] dark:bg-muted/15"
        aria-label="Market ticker"
        variants={v.section}
        initial={reduceMotion ? false : "hidden"}
        whileInView="visible"
        viewport={inView}
      >
        <BybitLinearTickerStrip />
      </motion.section>

      <section ref={heroRef} className="relative overflow-hidden pb-20 px-4 pt-12 sm:pt-16">
        {/* Parallax background — moves slower than scroll (foreground is in normal flow) */}
        <motion.div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ y: parallaxY }}
          aria-hidden
        >
          <div
            className="absolute -left-[20%] top-[-30%] h-[min(90vw,520px)] w-[min(90vw,520px)] rounded-full opacity-40 blur-[80px] dark:opacity-50"
            style={{
              background:
                "radial-gradient(circle, hsl(var(--primary) / 0.22) 0%, transparent 68%)",
            }}
          />
          <div
            className="absolute -right-[15%] bottom-[-40%] h-[min(70vw,400px)] w-[min(70vw,400px)] rounded-full opacity-35 blur-[72px] dark:opacity-45"
            style={{
              background:
                "radial-gradient(circle, hsl(var(--accent) / 0.18) 0%, transparent 70%)",
            }}
          />
        </motion.div>

        <motion.div
          className="relative z-10 container mx-auto max-w-4xl text-center"
          variants={v.heroStagger}
          initial={reduceMotion ? false : "hidden"}
          whileInView="visible"
          viewport={inView}
        >
          <motion.div variants={v.heroChild}>
            <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-6">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-medium text-primary">Live Trading Active</span>
            </div>
          </motion.div>

          <motion.div variants={v.heroChild}>
            <KineticHeroHeadline className="text-4xl sm:text-5xl md:text-6xl font-bold mb-6 leading-[1.08] tracking-tight" />
          </motion.div>

          <motion.p
            variants={v.heroChild}
            className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10"
            style={{ textWrap: "pretty" }}
          >
            Run algos and copy-trading on Mudrex futures from a single UI. No code.
          </motion.p>

          <motion.div variants={v.heroChild} className="flex flex-col sm:flex-row gap-4 justify-center">
            {loggedIn ? (
              <Link to="/dashboard">
                <Button variant="hero" size="lg">
                  <LayoutDashboard className="w-5 h-5" />
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <Link to="/auth">
                <Button variant="hero" size="lg">
                  Start Trading
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
            )}
            <Link to="/marketplace">
              <Button variant="outline" size="lg">
                <BarChart3 className="w-5 h-5" />
                Explore Strategies
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </section>

      <motion.section
        className="py-12 border-y border-border"
        variants={v.stagger}
        initial={reduceMotion ? false : "hidden"}
        whileInView="visible"
        viewport={inView}
      >
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <motion.div
                key={stat.label}
                variants={v.item}
                className="group/stat relative overflow-visible px-3 py-5 pb-2 text-center rounded-xl"
              >
                <div
                  className="landing-stat-glow-bar pointer-events-none absolute inset-0 z-0 rounded-xl bg-primary/20 opacity-0 blur-lg transition-opacity duration-500 group-hover/stat:opacity-100"
                  aria-hidden
                />
                <p className="relative z-[1] text-2xl md:text-3xl font-mono font-bold text-foreground">
                  {stat.value}
                </p>
                <p className="relative z-[1] mt-1 text-sm text-muted-foreground">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      <section className="py-24 px-4">
        <motion.div
          className="container mx-auto max-w-5xl"
          variants={v.stagger}
          initial={reduceMotion ? false : "hidden"}
          whileInView="visible"
          viewport={inView}
        >
          <motion.div variants={v.item} className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">What you get</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Algos, copy trading, and subs in one flow on top of Mudrex.
            </p>
          </motion.div>

          <motion.div variants={v.stagger} className="grid md:grid-cols-2 gap-6">
            {features.map((f) => (
              <motion.div
                key={f.title}
                variants={v.item}
                className="glass rounded-xl p-8 hover:border-primary/20 transition-all duration-300"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      <motion.section
        className="py-16 px-4"
        variants={v.section}
        initial={reduceMotion ? false : "hidden"}
        whileInView="visible"
        viewport={inView}
      >
        <div className="container mx-auto max-w-md text-center">
          <div className="glass rounded-xl p-6 sm:p-8 animate-pulse-glow">
            {loggedIn ? (
              <>
                <h2 className="text-xl sm:text-2xl font-bold mb-2">Welcome back</h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Jump into your dashboard to manage positions and strategies.
                </p>
                <Link to="/dashboard">
                  <Button variant="hero" size="default" className="w-full sm:w-auto">
                    <LayoutDashboard className="w-4 h-4" />
                    Dashboard
                  </Button>
                </Link>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </motion.section>

      <motion.footer
        className="border-t border-border py-8 px-4"
        variants={v.section}
        initial={reduceMotion ? false : "hidden"}
        whileInView="visible"
        viewport={inView}
      >
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
      </motion.footer>
    </div>
  );
}
