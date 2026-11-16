import { addNote, editNote, noNotes, removeNote, type NotesState, type ReviewNote } from "@golem/view";
import type { StoreSource } from "./create-store.ts";

export type Notes = StoreSource<ReadonlyMap<string, NotesState>> & {
  get(key: string): NotesState;
  add(key: string, note: Omit<ReviewNote, "id">): void;
  edit(key: string, id: string, text: string): void;
  remove(key: string, id: string): void;
  /** Drops the notes with these ids: the ones a send took, so a note written meanwhile stays. */
  drop(key: string, ids: readonly string[]): void;
  clear(key: string): void;
};

/** The review notes of each session, in memory like the drafts. A session with none takes no room. */
export function createNotes(): Notes {
  let all: ReadonlyMap<string, NotesState> = new Map();
  const listeners = new Set<() => void>();

  const get = (key: string): NotesState => all.get(key) ?? noNotes;

  function put(key: string, state: NotesState): void {
    const next = new Map(all);
    if (state.notes.length === 0) {
      next.delete(key);
    } else {
      next.set(key, state);
    }
    all = next;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  return {
    getSnapshot: () => all,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get,
    add: (key, note) => {
      put(key, addNote(get(key), note));
    },
    edit: (key, id, text) => {
      put(key, editNote(get(key), id, text));
    },
    remove: (key, id) => {
      put(key, removeNote(get(key), id));
    },
    drop(key, ids) {
      const state = get(key);
      if (state.notes.some((note) => ids.includes(note.id))) {
        put(key, { ...state, notes: state.notes.filter((note) => !ids.includes(note.id)) });
      }
    },
    clear(key) {
      if (get(key).notes.length > 0) {
        put(key, noNotes);
      }
    },
  };
}
