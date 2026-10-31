import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tokens.css removes Tailwind's colours, fonts, radii and shadows, so golem's names
// are listed here. Without them `text-ink` or `font-mono` would not be recognised.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "bg", "surface", "sunken", "ink", "muted", "faint", "line", "line-strong",
        "clay", "clay-ink", "clay-soft", "slip", "golem-body", "golem-eye",
        "allow", "allow-soft", "deny", "deny-soft", "wait", "wait-soft", "on-clay", "code-bg",
      ],
      font: ["ui", "prose", "mono"],
      radius: ["xs", "sm", "md", "lg", "xl"],
      shadow: ["soft"],
    },
  },
});

/** Joins class names; the last conflicting utility wins. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
