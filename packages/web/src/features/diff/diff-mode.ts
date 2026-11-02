import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export type DiffMode = "unified" | "split";

export const DIFF_MODE_KEY = "golem.diffMode";

/** The stored choice, or `unified` when there is none or storage is not available. */
export function readDiffMode(): DiffMode {
  try {
    return globalThis.localStorage.getItem(DIFF_MODE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

function writeDiffMode(mode: DiffMode): void {
  try {
    globalThis.localStorage.setItem(DIFF_MODE_KEY, mode);
  } catch {
    // The choice then lasts until the page closes.
  }
}

/** One choice for every diff in the page. */
export const diffModeStore = createStore<DiffMode>(readDiffMode());

export function useDiffMode(): [DiffMode, (mode: DiffMode) => void] {
  const mode = useSyncExternalStore(diffModeStore.subscribe, diffModeStore.getSnapshot);
  const setMode = useCallback((next: DiffMode) => {
    diffModeStore.set(next);
    writeDiffMode(next);
  }, []);
  return [mode, setMode];
}
