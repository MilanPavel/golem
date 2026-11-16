import { useCallback, useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

export const HIDDEN_FILES_KEY = "golem.files.hidden";

function read(): boolean {
  try {
    return globalThis.localStorage.getItem(HIDDEN_FILES_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the Files tab lists dot files. Off until the person turns it on; kept per browser. */
export const hiddenFilesStore = createStore<boolean>(read());

export function useHiddenFiles(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(hiddenFilesStore.subscribe, hiddenFilesStore.getSnapshot);
  const setOn = useCallback((next: boolean) => {
    hiddenFilesStore.set(next);
    try {
      globalThis.localStorage.setItem(HIDDEN_FILES_KEY, next ? "1" : "0");
    } catch {
      // The choice then lasts until the page closes.
    }
  }, []);
  return [on, setOn];
}
