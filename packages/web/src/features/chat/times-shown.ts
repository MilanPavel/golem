import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const TIMES_KEY = "golem.times";

/** The stored choice; with none, the times are shown (also when storage is missing or blocked). */
export function readTimesShown(): boolean {
  try {
    return globalThis.localStorage.getItem(TIMES_KEY) !== "hidden";
  } catch {
    return true;
  }
}

function writeTimesShown(shown: boolean): void {
  try {
    globalThis.localStorage.setItem(TIMES_KEY, shown ? "shown" : "hidden");
  } catch {
    // The choice then lasts until the page closes.
  }
}

/** One choice for every message in the page: whether the time sits beside each of yours. */
export const timesShownStore = createStore<boolean>(readTimesShown());

export function setTimesShown(shown: boolean): void {
  timesShownStore.set(shown);
  writeTimesShown(shown);
}

export function useTimesShown(): boolean {
  return useSyncExternalStore(timesShownStore.subscribe, timesShownStore.getSnapshot);
}
