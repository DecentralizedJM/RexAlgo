import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Moon, Sun } from "lucide-react";

/** One switch: off = light, on = dark (default). */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-6 w-11 rounded-full bg-muted/50 shrink-0" aria-hidden />;
  }

  const isDark = resolvedTheme === "dark" || theme === "dark";

  return (
    <div className="flex items-center gap-1.5 shrink-0" title={isDark ? "Dark mode" : "Light mode"}>
      <Sun className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <Switch
        checked={isDark}
        onCheckedChange={(on) => setTheme(on ? "dark" : "light")}
        aria-label={isDark ? "Use light mode" : "Use dark mode"}
        className="scale-90"
      />
      <Moon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
    </div>
  );
}
