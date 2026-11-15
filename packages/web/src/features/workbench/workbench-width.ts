import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const WORKBENCH_WIDTH_KEY = "golem.workbench.width";

/** In rem. The start is the panel's `w-80`. */
export const WORKBENCH_DEFAULT = 20;
export const WORKBENCH_MIN = 16;
/** The most the handle sets. Beside the chat the panel also never takes more than three fifths of the row. */
export const WORKBENCH_MAX = 60;
/** What one arrow key moves the handle. */
export const WORKBENCH_STEP = 2;

export function clampWorkbenchWidth(rem: number): number {
  return Math.min(WORKBENCH_MAX, Math.max(WORKBENCH_MIN, Math.round(rem)));
}

function read(): number {
  try {
    const stored = Number(globalThis.localStorage.getItem(WORKBENCH_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampWorkbenchWidth(stored);
  } catch {
    // Storage is missing or blocked: the default.
  }
  return WORKBENCH_DEFAULT;
}

/** One width for every session in the page, kept per browser. */
export const workbenchWidthStore = createStore<number>(read());

export function useWorkbenchWidth(): [number, (rem: number) => void] {
  const width = useSyncExternalStore(workbenchWidthStore.subscribe, workbenchWidthStore.getSnapshot);
  const setWidth = useCallback((rem: number) => {
    const next = clampWorkbenchWidth(rem);
    workbenchWidthStore.set(next);
    try {
      globalThis.localStorage.setItem(WORKBENCH_WIDTH_KEY, String(next));
    } catch {
      // The width then lasts until the page closes.
    }
  }, []);
  return [width, setWidth];
}
