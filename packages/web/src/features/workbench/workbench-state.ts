import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";
import { DRAWER_KEY, drawerOpenStore } from "../drawer/drawer-open.ts";

export const TAB_KEY = "golem.workbench.tab";

function read(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // The choice then lasts until the page closes.
  }
}

/** The chosen tab, one for every session in the page. */
export const tabStore = createStore<string | null>(read(TAB_KEY));
const requestedStore = createStore<string | null>(null);

/** The chosen tab, or null before a choice. */
export function useWorkbenchTab(): [string | null, (id: string) => void] {
  const tab = useSyncExternalStore(tabStore.subscribe, tabStore.getSnapshot);
  const setTab = useCallback((id: string) => {
    tabStore.set(id);
    write(TAB_KEY, id);
  }, []);
  return [tab, setTab];
}

/** Opens the panel on that tab, from anywhere. With no such tab the panel shows its first. */
export function openWorkbench(tab: string): void {
  tabStore.set(tab);
  write(TAB_KEY, tab);
  drawerOpenStore.set(true);
  write(DRAWER_KEY, "open");
}

/** Opens the Changes tab and remembers `path` as the file to show. */
export function openChange(path: string): void {
  requestedStore.set(path);
  openWorkbench("changes");
}

/** The remembered path, and a function that clears it. */
export function useRequestedChange(): [string | null, () => void] {
  const path = useSyncExternalStore(requestedStore.subscribe, requestedStore.getSnapshot);
  const clear = useCallback(() => requestedStore.set(null), []);
  return [path, clear];
}
