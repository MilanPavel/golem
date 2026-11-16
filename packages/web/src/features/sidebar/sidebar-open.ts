import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const SIDEBAR_OPEN_KEY = "golem.sidebar.open";

function read(): boolean | null {
  try {
    const stored = globalThis.localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Storage is missing or blocked: no choice yet.
  }
  return null;
}

/** Whether the panel is open. `null` means the user has not chosen, so the shell uses its default for the window size. */
export const sidebarOpenStore = createStore<boolean | null>(read());

export function useSidebarOpen(): [boolean | null, (open: boolean) => void] {
  const open = useSyncExternalStore(sidebarOpenStore.subscribe, sidebarOpenStore.getSnapshot);
  const setOpen = useCallback((next: boolean) => {
    sidebarOpenStore.set(next);
    try {
      globalThis.localStorage.setItem(SIDEBAR_OPEN_KEY, next ? "1" : "0");
    } catch {
      // The choice then lasts until the page closes.
    }
  }, []);
  return [open, setOpen];
}
