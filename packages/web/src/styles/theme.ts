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

const listeners = new Set<(choice: ThemeChoice) => void>();

/** Calls `listener` with each theme that is applied, so switches in two places stay in step. Returns the unsubscribe. */
export function onThemeApplied(listener: (choice: ThemeChoice) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
  for (const listener of [...listeners]) listener(choice);
}
