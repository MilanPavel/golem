import type { SessionSummary } from "@golem/client";
import { createStore, type StoreSource } from "./create-store.ts";

/**
 * Where the next new session will run and on what model. `chosen` is the folder the person picked
 * on the empty screen; `lastOpened` is the folder of the session they last looked at. `undefined`
 * means not known yet. `model` is the model they picked, or null for the default. It is shown and
 * not stored: a reload starts from the default again.
 */
export type NewSessionState = {
  chosen: string | null | undefined;
  lastOpened: string | null | undefined;
  model: string | null;
};

export type NewSessionStore = StoreSource<NewSessionState> & {
  /** The person picks a folder (null for none). */
  choose(folder: string | null): void;
  /** A session was opened. Its folder becomes the default, and an earlier pick is dropped. */
  opened(cwd: string | null): void;
  /** The person picks a model for the next session (null for the default). */
  chooseModel(model: string | null): void;
};

export function createNewSession(): NewSessionStore {
  const store = createStore<NewSessionState>({ chosen: undefined, lastOpened: undefined, model: null });
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
        store.set({ ...state, chosen: undefined, lastOpened: cwd });
      }
    },
    chooseModel(model) {
      const state = store.getSnapshot();
      if (state.model !== model) {
        store.set({ ...state, model });
      }
    },
  };
}

/** Sessions that are not closed, as the sidebar shows them. */
function open(list: readonly SessionSummary[]): SessionSummary[] {
  return list.filter((session) => session.status !== "closed");
}

/** The folder a new session gets: the pick, else the last opened session's, else the newest session's, else none. */
export function resolveFolder(state: NewSessionState, list: readonly SessionSummary[]): string | null {
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
