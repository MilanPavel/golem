import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";
import type { RailItem } from "./rail.tsx";

export const SIDEBAR_ITEM_KEY = "golem.sidebar.item";

export const SIDEBAR_ITEMS: readonly RailItem[] = ["sessions", "inbox", "routines", "workflows", "runs"];

function read(): RailItem {
  try {
    const stored = globalThis.localStorage.getItem(SIDEBAR_ITEM_KEY);
    const found = SIDEBAR_ITEMS.find((item) => item === stored);
    if (found !== undefined) return found;
  } catch {
    // Storage is missing or blocked: the default.
  }
  return "sessions";
}

/** The rail item whose panel shows. It is panel state, not a route. */
export const sidebarItemStore = createStore<RailItem>(read());

export function useSidebarItem(): [RailItem, (item: RailItem) => void] {
  const item = useSyncExternalStore(sidebarItemStore.subscribe, sidebarItemStore.getSnapshot);
  const setItem = useCallback((next: RailItem) => {
    sidebarItemStore.set(next);
    try {
      globalThis.localStorage.setItem(SIDEBAR_ITEM_KEY, next);
    } catch {
      // The choice then lasts until the page closes.
    }
  }, []);
  return [item, setItem];
}
