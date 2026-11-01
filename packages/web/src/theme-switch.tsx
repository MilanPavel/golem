import { useState } from "react";
import { cn } from "./ui/cn.ts";
import { applyTheme, readTheme, type ThemeChoice } from "./styles/theme.ts";

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "slip", label: "Slip" },
  { value: "kiln", label: "Kiln" },
];

/** `compact` is for the sidebar: no top margin, no visible label, smaller buttons. */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const choose = (value: ThemeChoice) => {
    applyTheme(value);
    setTheme(value);
  };
  return (
    <div role="group" aria-label="Theme" className={cn("flex items-center gap-2", !compact && "mt-6")}>
      <span className={cn("text-sm text-muted", compact && "sr-only")}>Theme</span>
      {CHOICES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => choose(value)}
          className={cn(
            "rounded-md border border-line-strong bg-surface px-3 py-1 text-sm outline-offset-2 outline-clay focus-visible:outline-2 aria-pressed:bg-clay-soft aria-pressed:text-clay-ink",
            compact && "px-2 py-0.5 text-xs",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
