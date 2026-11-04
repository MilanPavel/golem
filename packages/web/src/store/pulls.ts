import type { GolemClient, PullUpdate } from "@golem/client";
import { trackPull, type PullTrack } from "@golem/view";
import { createStore, type StoreSource } from "./create-store.ts";

export type PullsClient = Pick<GolemClient, "onPull" | "onState" | "setSessionModel">;

/** A download in progress: its byte track for speed and time left, and the daemon's last words. */
export type PullEntry = { track: PullTrack; status: string; progress: number | null };

export type PullsSnapshot = {
  /** Downloads that are running, from any connection. */
  active: ReadonlyMap<string, PullEntry>;
  /** The last failure of a ref, until it starts again or ends well. A stop is not a failure. */
  failed: ReadonlyMap<string, string>;
};

export type Pulls = StoreSource<PullsSnapshot> & {
  /** A download was asked for: the row shows it at once, and an old failure goes. */
  begin(ref: string): void;
  /** The ask was refused: the row goes back. */
  abort(ref: string): void;
  /** Switch the session to the model once its download ends well. */
  switchWhenDone(ref: string, sessionId: string): void;
  /** Drop the wish for a download the person stopped. */
  forget(ref: string): void;
  start(): void;
  stop(): void;
};

const EMPTY: PullsSnapshot = { active: new Map(), failed: new Map() };
const CANCELLED = "cancelled";

function without<V>(map: ReadonlyMap<string, V>, ref: string): ReadonlyMap<string, V> {
  if (!map.has(ref)) {
    return map;
  }
  const next = new Map(map);
  next.delete(ref);
  return next;
}

function withEntry<V>(map: ReadonlyMap<string, V>, ref: string, value: V): ReadonlyMap<string, V> {
  return new Map(map).set(ref, value);
}

/**
 * The downloads in flight. Progress arrives for every connection, so a download started in the
 * terminal shows here as well. `now` is injected so tests can move time.
 */
export function createPulls(client: PullsClient, now: () => number = Date.now): Pulls {
  const store = createStore<PullsSnapshot>(EMPTY);
  const wishes = new Map<string, string>();
  let offs: (() => void)[] | undefined;
  let dropped = false;

  /** A new snapshot only when a map changed, so a no-op wakes nobody. */
  function commit(active: PullsSnapshot["active"], failed: PullsSnapshot["failed"]): void {
    const snapshot = store.getSnapshot();
    if (active !== snapshot.active || failed !== snapshot.failed) {
      store.set({ active, failed });
    }
  }

  function progress(update: Extract<PullUpdate, { kind: "progress" }>): void {
    const { ref, completed, total, progress: share, status } = update.progress;
    const snapshot = store.getSnapshot();
    const known = snapshot.active.get(ref)?.track ?? { completed: 0, total: null, samples: [] };
    const track = trackPull(known, completed ?? null, total ?? null, now());
    commit(withEntry(snapshot.active, ref, { track, status, progress: share ?? null }), without(snapshot.failed, ref));
  }

  function done(update: Extract<PullUpdate, { kind: "done" }>): void {
    const { ref, ok, error } = update.done;
    const snapshot = store.getSnapshot();
    const sessionId = wishes.get(ref);
    wishes.delete(ref);
    const failed =
      ok || error === CANCELLED
        ? without(snapshot.failed, ref)
        : withEntry(snapshot.failed, ref, error ?? "The download failed.");
    commit(without(snapshot.active, ref), failed);
    if (ok && sessionId !== undefined) {
      client.setSessionModel(sessionId, ref).catch(() => undefined);
    }
  }

  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    begin(ref) {
      const snapshot = store.getSnapshot();
      if (snapshot.active.has(ref)) {
        return;
      }
      const track: PullTrack = { completed: 0, total: null, samples: [] };
      commit(withEntry(snapshot.active, ref, { track, status: "starting", progress: null }), without(snapshot.failed, ref));
    },
    abort(ref) {
      wishes.delete(ref);
      const snapshot = store.getSnapshot();
      commit(without(snapshot.active, ref), snapshot.failed);
    },
    switchWhenDone(ref, sessionId) {
      wishes.set(ref, sessionId);
    },
    forget(ref) {
      wishes.delete(ref);
    },
    start() {
      if (offs !== undefined) {
        return;
      }
      offs = [
        client.onPull((update) => {
          if (update.kind === "progress") {
            progress(update);
          } else {
            done(update);
          }
        }),
        // A `done` sent while the link was down is lost, and a restarted daemon forgets its
        // downloads. After a drop the rows go back to the refetched listing, and a download
        // that is still running comes back with its next progress.
        client.onState((state) => {
          if (state.status !== "connected") {
            dropped = true;
            return;
          }
          if (dropped) {
            dropped = false;
            commit(EMPTY.active, store.getSnapshot().failed);
          }
        }),
      ];
    },
    stop() {
      for (const off of offs ?? []) off();
      offs = undefined;
      dropped = false;
      wishes.clear();
      store.set(EMPTY);
    },
  };
}
