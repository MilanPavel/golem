import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const THINKING_KEY = "golem.thinking";

/** The stored choice; with none, the thinking line is shown (also when storage is missing or blocked). */
export function readThinkingShown(): boolean {
  try {
    return globalThis.localStorage.getItem(THINKING_KEY) !== "hidden";
  } catch {
    return true;
  }
}

function writeThinkingShown(shown: boolean): void {
  try {
    globalThis.localStorage.setItem(THINKING_KEY, shown ? "shown" : "hidden");
  } catch {
    // The choice then lasts until the page closes.
  }
}

/** One choice for every answer in the page: whether the thinking line sits above it. */
export const thinkingShownStore = createStore<boolean>(readThinkingShown());

export function setThinkingShown(shown: boolean): void {
  thinkingShownStore.set(shown);
  writeThinkingShown(shown);
}

export function useThinkingShown(): boolean {
  return useSyncExternalStore(thinkingShownStore.subscribe, thinkingShownStore.getSnapshot);
}
