import { noPastes, type Pastes } from "@golem/view";
import type { StoreSource } from "./create-store.ts";

/** What the person has typed and not sent, with the long pastes behind its tokens. */
export type DraftState = { text: string; pastes: Pastes };

/** The draft of the empty screen. Sessions use their id. */
export const NEW_DRAFT_KEY = "new";

export const emptyDraft: DraftState = { text: "", pastes: noPastes };

export type Drafts = StoreSource<ReadonlyMap<string, DraftState>> & {
  get(key: string): DraftState;
  setText(key: string, text: string): void;
  setPastes(key: string, pastes: Pastes): void;
};

/** One draft per key, in memory only. An empty draft takes no room. */
export function createDrafts(): Drafts {
  let drafts: ReadonlyMap<string, DraftState> = new Map();
  const listeners = new Set<() => void>();

  function put(key: string, draft: DraftState): void {
    const next = new Map(drafts);
    if (draft.text === "" && draft.pastes.texts.size === 0) {
      next.delete(key);
    } else {
      next.set(key, draft);
    }
    drafts = next;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  const get = (key: string): DraftState => drafts.get(key) ?? emptyDraft;
  return {
    getSnapshot: () => drafts,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get,
    setText(key, text) {
      const draft = get(key);
      if (draft.text !== text) {
        put(key, { ...draft, text });
      }
    },
    setPastes(key, pastes) {
      const draft = get(key);
      if (draft.pastes !== pastes) {
        put(key, { ...draft, pastes });
      }
    },
  };
}
