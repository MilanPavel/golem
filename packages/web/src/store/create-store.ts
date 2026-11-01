/** What `useSyncExternalStore` needs from a store. */
export type StoreSource<S> = {
  getSnapshot(): S;
  subscribe(listener: () => void): () => void;
};

export type Store<S> = StoreSource<S> & { set(next: S): void };

/**
 * A snapshot and its listeners. `set` with the same reference notifies nobody, so a fold that
 * changes nothing costs no render.
 */
export function createStore<S>(initial: S): Store<S> {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (Object.is(next, snapshot)) {
        return;
      }
      snapshot = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}
