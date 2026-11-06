export type ThemeChoice = "system" | "slip" | "kiln";

const KEY = "golem.theme";

function isChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "slip" || value === "kiln";
}

export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return isChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage may be blocked; the choice then lasts until the page closes.
  }
}
