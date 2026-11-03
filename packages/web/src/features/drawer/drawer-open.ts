import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const DRAWER_KEY = "golem.drawer";

/** The width from which the drawer sits beside the column; it is `--breakpoint-wide` in tokens.css. */
export const WIDE_QUERY = "(min-width: 68.75rem)";

function isWide(): boolean {
  try {
    return typeof globalThis.matchMedia === "function" && globalThis.matchMedia(WIDE_QUERY).matches;
  } catch {
    return false;
  }
}

/** The stored choice; with none, open on a wide window and closed otherwise (also when storage or matchMedia is missing). */
export function readDrawerOpen(): boolean {
  try {
    const stored = globalThis.localStorage.getItem(DRAWER_KEY);
    if (stored === "open") return true;
    if (stored === "closed") return false;
  } catch {
    // Fall through to the default.
  }
  return isWide();
}

function writeDrawerOpen(open: boolean): void {
  try {
    globalThis.localStorage.setItem(DRAWER_KEY, open ? "open" : "closed");
  } catch {
    // The choice then lasts until the page closes.
  }
}

/** One choice for every session in the page. */
export const drawerOpenStore = createStore<boolean>(readDrawerOpen());

export function useDrawerOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(drawerOpenStore.subscribe, drawerOpenStore.getSnapshot);
  const setOpen = useCallback((next: boolean) => {
    drawerOpenStore.set(next);
    writeDrawerOpen(next);
  }, []);
  return [open, setOpen];
}
