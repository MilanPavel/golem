import { useSyncExternalStore } from "react";
import { createStore } from "../../store/create-store.ts";

/**
 * The composer on screen, as the command palette sees it. A command runs in it, so the dialogs it
 * opens and the notice it shows belong to the page that has it.
 */
export type ActiveComposer = {
  /** Runs a line as the composer would on Enter: a message, or a command. */
  run: (line: string) => Promise<unknown>;
  /** Replaces the draft, puts the caret at its end, and focuses the field. */
  insert: (text: string) => void;
  focus: () => void;
};

const store = createStore<ActiveComposer | null>(null);

/** A mounted composer says it is the one on screen. The last to register wins. Returns what unregisters it. */
export function registerComposer(composer: ActiveComposer): () => void {
  store.set(composer);
  return () => {
    if (store.getSnapshot() === composer) store.set(null);
  };
}

export function activeComposer(): ActiveComposer | null {
  return store.getSnapshot();
}

/** Whether a composer is on screen. The gone screen and the full-screen states have none. */
export function useHasComposer(): boolean {
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot() !== null);
}
