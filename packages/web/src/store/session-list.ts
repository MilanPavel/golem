import { mergeSummary, type GolemClient, type SessionSummary } from "@golem/client";
import { createStore, type StoreSource } from "./create-store.ts";

export type { SessionSummary };

export type SessionListClient = Pick<GolemClient, "onSessionSummary" | "watchSessions" | "ready">;

export type SessionList = StoreSource<readonly SessionSummary[]> & {
  /** Watch the list once the client is ready. The client watches again after a reconnect. */
  start(): void;
  stop(): void;
};

/** The live list, newest activity first. It does not need a session to be attached. */
export function createSessionList(client: SessionListClient): SessionList {
  const store = createStore<readonly SessionSummary[]>([]);
  let off: (() => void) | undefined;
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    start() {
      if (off) {
        return;
      }
      off = client.onSessionSummary((summary) => {
        store.set(mergeSummary(store.getSnapshot(), summary));
      });
      void (async () => {
        try {
          await client.ready;
          await client.watchSessions();
        } catch {
          // No link, or a rejected one. The connection screens say so.
        }
      })();
    },
    stop() {
      off?.();
      off = undefined;
    },
  };
}
