import type { ModelListResult } from "@golem/client";
import {
  FIRST_RUN_OPTIONS,
  hostedProviders,
  localNeeds,
  recommendedLocal,
  type FirstRunKey,
  type FirstRunOption,
} from "@golem/view";

import type { Press } from "./keys.ts";

export type WelcomeRow =
  | { kind: "title"; text: string }
  | { kind: "option"; label: string; detail: string; selected: boolean }
  | { kind: "hint"; text: string }
  | { kind: "blank" };

const LABELS: Record<FirstRunOption, string> = {
  local: "On this Mac",
  key: "With an API key",
  later: "Later",
};

const NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  groq: "Groq",
  together: "Together",
};

export const WELCOME_HINT = "Enter picks · ↑↓ move · Esc later";

/** The three choices of a first start, with what each one would do. */
export function layoutWelcome(option: FirstRunOption, listing: ModelListResult): WelcomeRow[] {
  return [
    { kind: "title", text: "Welcome to golem. How should it think?" },
    { kind: "blank" },
    ...FIRST_RUN_OPTIONS.map(
      (each): WelcomeRow => ({ kind: "option", label: LABELS[each], detail: detailOf(each, listing), selected: each === option }),
    ),
    { kind: "blank" },
    { kind: "hint", text: WELCOME_HINT },
  ];
}

function detailOf(option: FirstRunOption, listing: ModelListResult): string {
  switch (option) {
    case "local": {
      const model = recommendedLocal(listing);
      if (model === null) {
        return "private, free · pick a model that fits";
      }
      if (model.status === "ready") {
        return `private, free · ${model.label}, ready`;
      }
      const size = model.size_gb === null || model.size_gb === undefined ? "" : ` · ${model.size_gb} GB`;
      const install = localNeeds(listing) === "install" ? " · installs Ollama" : "";
      return `private, free · ${model.label}${size}${install}`;
    }
    case "key": {
      const names = hostedProviders(listing).map((name) => NAMES[name] ?? name);
      return names.length > 0 ? names.join(", ") : "a hosted provider";
    }
    case "later":
      return "/model any time";
  }
}

/** The card's keys. Esc and Ctrl-C choose Later. Anything else does nothing. */
export function welcomeKeyOf(press: Press): FirstRunKey | "later" | null {
  switch (press.name) {
    case "up":
      return "up";
    case "down":
      return "down";
    case "return":
      return "enter";
    case "escape":
    case "ctrl-c":
      return "later";
    default:
      return null;
  }
}
