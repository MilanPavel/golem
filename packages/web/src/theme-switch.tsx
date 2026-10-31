import { useState } from "react";
import { applyTheme, readTheme, type ThemeChoice } from "./styles/theme.ts";

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "slip", label: "Slip" },
  { value: "kiln", label: "Kiln" },
];

export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const choose = (value: ThemeChoice) => {
    applyTheme(value);
    setTheme(value);
  };
  return (
    <div role="group" aria-label="Theme" className="mt-6 flex items-center gap-2">
      <span className="text-sm text-muted">Theme</span>
      {CHOICES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => choose(value)}
          className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm outline-offset-2 outline-clay focus-visible:outline-2 aria-pressed:bg-clay-soft aria-pressed:text-clay-ink"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
