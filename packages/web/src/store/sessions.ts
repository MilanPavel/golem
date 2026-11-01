import { RpcError, SESSION_NOT_FOUND, type GolemClient } from "@golem/client";
import { createSessionStore, type Frame, type SessionStore } from "./session-store.ts";

export type SessionsClient = Pick<GolemClient, "onEvent" | "attachSession" | "detachSession">;

export type Sessions = {
  /** The store for `id`, attached from the start so the whole history replays. Idempotent. */
  open(id: string): SessionStore;
  /** Detach and drop the store. */
  close(id: string): void;
  get(id: string): SessionStore | undefined;
  /** Stop listening and drop every store. */
  stop(): void;
};

/**
 * The sessions this page has open. One client listener routes each event to its session's store.
 * A reconnect needs nothing here: the client attaches again from the last `seq` by itself.
 */
export function createSessions(client: SessionsClient, frame?: Frame): Sessions {
  const stores = new Map<string, SessionStore>();

  const off = client.onEvent((event) => {
    stores.get(event.session_id)?.dispatch(event);
  });

  async function attach(id: string, store: SessionStore): Promise<void> {
    try {
      await client.attachSession(id);
      if (stores.get(id) === store) {
        store.setStatus("ready");
      }
    } catch (error) {
      if (error instanceof RpcError && error.code === SESSION_NOT_FOUND && stores.get(id) === store) {
        store.setStatus("gone");
      }
      // Any other failure is the link going away. The client attaches again when it is back.
    }
  }

  return {
    open(id) {
      const existing = stores.get(id);
      if (existing) {
        return existing;
      }
      const store = createSessionStore(frame, `session ${id}`);
      stores.set(id, store);
      void attach(id, store);
      return store;
    },
    close(id) {
      const store = stores.get(id);
      if (!store) {
        return;
      }
      stores.delete(id);
      store.dispose();
      client.detachSession(id).catch(() => undefined);
    },
    get: (id) => stores.get(id),
    stop() {
      off();
      for (const store of stores.values()) {
        store.dispose();
      }
      stores.clear();
    },
  };
}
