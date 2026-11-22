import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const THINKING_KEY = "golem.thinking";

/** How the thinking line sits above an answer: not at all, folded, or with its text showing. */
export type ThinkingMode = "hidden" | "collapsed" | "open";
export const THINKING_MODES: readonly ThinkingMode[] = ["hidden", "collapsed", "open"];

/** What is kept for each mode. Collapsed is `shown`, the word an older page wrote. */
const STORED: Record<ThinkingMode, string> = { hidden: "hidden", collapsed: "shown", open: "open" };

/** The stored choice; with none, or a word that is not one, Collapsed (also when storage is missing or blocked). `shown` reads as Collapsed. */
export function readThinkingMode(): ThinkingMode {
  try {
    const stored = globalThis.localStorage.getItem(THINKING_KEY);
    return stored === "hidden" ? "hidden" : stored === "open" ? "open" : "collapsed";
  } catch {
    return "collapsed";
  }
}

function writeThinkingMode(mode: ThinkingMode): void {
  try {
    globalThis.localStorage.setItem(THINKING_KEY, STORED[mode]);
  } catch {
    // The choice then lasts until the page closes.
  }
}

/** One choice for every answer in the page: how the thinking line sits above it. */
export const thinkingModeStore = createStore<ThinkingMode>(readThinkingMode());

export function setThinkingMode(mode: ThinkingMode): void {
  thinkingModeStore.set(mode);
  writeThinkingMode(mode);
}

export function useThinkingMode(): ThinkingMode {
  return useSyncExternalStore(thinkingModeStore.subscribe, thinkingModeStore.getSnapshot);
}
