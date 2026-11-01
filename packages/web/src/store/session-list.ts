import { mergeSummary, type GolemClient, type SessionSummary } from "@golem/client";
import { createStore, type StoreSource } from "./create-store.ts";

export type SessionListClient = Pick<GolemClient, "onSessionSummary" | "watchSessions" | "ready">;

export type SessionList = StoreSource<readonly SessionSummary[]> & {
  /** Watch the list once the client is ready. The client watches again after a reconnect. */
  start(): void;
  stop(): void;
};

export type FolderGroup = { folder: string | null; sessions: SessionSummary[] };

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

/** Sessions by folder. Folders are ordered by their newest session, and no folder comes last. */
export function groupByFolder(list: readonly SessionSummary[]): FolderGroup[] {
  const groups = new Map<string | null, SessionSummary[]>();
  for (const session of list) {
    const folder = session.cwd ?? null;
    const group = groups.get(folder);
    if (group) {
      group.push(session);
    } else {
      groups.set(folder, [session]);
    }
  }
  const newest = (group: SessionSummary[]): string =>
    group.reduce((latest, session) => (session.updated_at > latest ? session.updated_at : latest), "");
  return [...groups.entries()]
    .map(([folder, sessions]) => ({ folder, sessions }))
    .sort((a, b) => {
      if ((a.folder === null) !== (b.folder === null)) {
        return a.folder === null ? 1 : -1;
      }
      const left = newest(a.sessions);
      const right = newest(b.sessions);
      return left === right ? 0 : left < right ? 1 : -1;
    });
}
