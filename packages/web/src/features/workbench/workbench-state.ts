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

/** A file the Files tab was asked to show, and the line to scroll to. */
export type FileRequest = { path: string; line: number | null };

const requestedFileStore = createStore<FileRequest | null>(null);

/** Opens the panel on Files with `path` shown, scrolled to `line` (1 is the first) when given. */
export function openFile(path: string, line?: number): void {
  requestedFileStore.set({ path, line: line ?? null });
  openWorkbench("files");
}

/** The requested file, and a function that clears the request. */
export function useRequestedFile(): [FileRequest | null, () => void] {
  const request = useSyncExternalStore(requestedFileStore.subscribe, requestedFileStore.getSnapshot);
  const clear = useCallback(() => requestedFileStore.set(null), []);
  return [request, clear];
}

const commitRequestStore = createStore<boolean>(false);

/** Asks the Changes tab to open its commit dialog. Opens the tab too. */
export function requestCommit(): void {
  commitRequestStore.set(true);
  openWorkbench("changes");
}

/** Whether the commit dialog was asked for, and a function that clears the request. */
export function useCommitRequest(): [boolean, () => void] {
  const asked = useSyncExternalStore(commitRequestStore.subscribe, commitRequestStore.getSnapshot);
  const clear = useCallback(() => commitRequestStore.set(false), []);
  return [asked, clear];
}

/** The remembered path, and a function that clears it. */
export function useRequestedChange(): [string | null, () => void] {
  const path = useSyncExternalStore(requestedStore.subscribe, requestedStore.getSnapshot);
  const clear = useCallback(() => requestedStore.set(null), []);
  return [path, clear];
}
