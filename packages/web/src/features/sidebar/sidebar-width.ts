import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const SIDEBAR_WIDTH_KEY = "golem.sidebar.width";

/** In rem. The default mirrors `--spacing-sidebar` in tokens.css (268 px). */
export const SIDEBAR_DEFAULT = 16.75;
/** 200 px. */
export const SIDEBAR_MIN = 12.5;
/** 420 px. */
export const SIDEBAR_MAX = 26.25;
/** What one arrow key moves the handle. */
export const SIDEBAR_STEP = 1;
/** 150 px. Dragging the handle under this hides the panel. */
export const COLLAPSE_BELOW = 9.375;

export function clampSidebarWidth(rem: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, rem));
}

function read(): number {
  try {
    const raw = globalThis.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const stored = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
    if (Number.isFinite(stored) && stored > 0) return clampSidebarWidth(stored);
  } catch {
    // Storage is missing or blocked: the default.
  }
  return SIDEBAR_DEFAULT;
}

/** One width for the sidebar panel, kept per browser. */
export const sidebarWidthStore = createStore<number>(read());

export function useSidebarWidth(): [number, (rem: number) => void] {
  const width = useSyncExternalStore(sidebarWidthStore.subscribe, sidebarWidthStore.getSnapshot);
  const setWidth = useCallback((rem: number) => {
    const next = clampSidebarWidth(rem);
    sidebarWidthStore.set(next);
    try {
      globalThis.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    } catch {
      // The width then lasts until the page closes.
    }
  }, []);
  return [width, setWidth];
}
