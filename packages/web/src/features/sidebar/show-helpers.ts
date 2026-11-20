import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const SHOW_HELPERS_KEY = "golem.sessions.showHelpers";

function read(): boolean {
  try {
    return globalThis.localStorage.getItem(SHOW_HELPERS_KEY) === "1";
  } catch {
    // Storage is missing or blocked: the default holds, helpers are not rows.
    return false;
  }
}

/** Whether the Sessions list shows helper sessions as rows. A per-viewer choice, off by default. */
export const showHelpersStore = createStore<boolean>(read());

export function useShowHelpers(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(showHelpersStore.subscribe, showHelpersStore.getSnapshot);
  const setShow = useCallback((next: boolean) => {
    showHelpersStore.set(next);
    try {
      globalThis.localStorage.setItem(SHOW_HELPERS_KEY, next ? "1" : "0");
    } catch {
      // The choice then lasts until the page closes.
    }
  }, []);
  return [show, setShow];
}
