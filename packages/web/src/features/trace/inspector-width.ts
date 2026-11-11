import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const INSPECTOR_WIDTH_KEY = "golem.inspector-width";

/** In rem. The start and the least mirror `--spacing-inspector` and `--spacing-inspector-min` in tokens.css. */
export const INSPECTOR_DEFAULT = 26;
export const INSPECTOR_MIN = 20;
/** The most the handle sets. The panel also never takes more than three fifths of the main area (`max-w-3/5`). */
export const INSPECTOR_MAX = 60;
/** What one arrow key moves the handle. */
export const INSPECTOR_STEP = 2;

export function clampInspectorWidth(rem: number): number {
  return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(rem)));
}

function read(): number {
  try {
    const stored = Number(globalThis.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampInspectorWidth(stored);
  } catch {
    // Storage is missing or blocked: the default.
  }
  return INSPECTOR_DEFAULT;
}

/** One width for every session in the page, kept per browser. */
export const inspectorWidthStore = createStore<number>(read());

export function useInspectorWidth(): [number, (rem: number) => void] {
  const width = useSyncExternalStore(inspectorWidthStore.subscribe, inspectorWidthStore.getSnapshot);
  const setWidth = useCallback((rem: number) => {
    const next = clampInspectorWidth(rem);
    inspectorWidthStore.set(next);
    try {
      globalThis.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(next));
    } catch {
      // The width then lasts until the page closes.
    }
  }, []);
  return [width, setWidth];
}
