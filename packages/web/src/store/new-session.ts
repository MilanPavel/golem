import type { SessionSummary } from "@golem/client";
import { createStore, type StoreSource } from "./create-store.ts";

/**
 * Where the next new session will run. `chosen` is what the person picked on the empty screen;
 * `lastOpened` is the folder of the session they last looked at. `undefined` means not known yet.
 */
export type NewSessionFolderState = {
  chosen: string | null | undefined;
  lastOpened: string | null | undefined;
};

export type NewSessionFolderStore = StoreSource<NewSessionFolderState> & {
  /** The person picks a folder (null for none). */
  choose(folder: string | null): void;
  /** A session was opened. Its folder becomes the default, and an earlier pick is dropped. */
  opened(cwd: string | null): void;
};

export function createNewSessionFolder(): NewSessionFolderStore {
  const store = createStore<NewSessionFolderState>({ chosen: undefined, lastOpened: undefined });
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    choose(folder) {
      const state = store.getSnapshot();
      if (state.chosen !== folder) {
        store.set({ ...state, chosen: folder });
      }
    },
    opened(cwd) {
      const state = store.getSnapshot();
      if (state.chosen !== undefined || state.lastOpened !== cwd) {
        store.set({ chosen: undefined, lastOpened: cwd });
      }
    },
  };
}

/** Sessions that are not closed, as the sidebar shows them. */
function open(list: readonly SessionSummary[]): SessionSummary[] {
  return list.filter((session) => session.status !== "closed");
}

/** The folder a new session gets: the pick, else the last opened session's, else the newest session's, else none. */
export function resolveFolder(state: NewSessionFolderState, list: readonly SessionSummary[]): string | null {
  if (state.chosen !== undefined) {
    return state.chosen;
  }
  if (state.lastOpened !== undefined) {
    return state.lastOpened;
  }
  return open(list)[0]?.cwd ?? null;
}

/** Every distinct folder in the list, in the list's order (newest first). */
export function distinctFolders(list: readonly SessionSummary[]): string[] {
  const seen = new Set<string>();
  for (const session of open(list)) {
    if (session.cwd) {
      seen.add(session.cwd);
    }
  }
  return [...seen];
}
