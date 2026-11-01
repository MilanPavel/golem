import type { ConnectionState, GolemClient } from "@golem/client";

export { DAEMON_DOWN_CLOSE_CODE, type ConnectionState } from "@golem/client";
export { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "../../../protocol/gen/version.ts";

export type ConnectionSnapshot = { state: ConnectionState; daemonVersion: string | null };

/** What `useSyncExternalStore` needs, and all the features see of the connection. */
export type ConnectionSource = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConnectionSnapshot;
};

export type ConnectionStore = ConnectionSource & { start(): void; stop(): void };

/** The part of the client the store uses. */
export type ConnectionClient = Pick<GolemClient, "state" | "onState" | "status" | "close">;

function sameState(a: ConnectionState, b: ConnectionState): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

/**
 * Holds the link state and the daemon's version. The snapshot is a new object only when one of
 * them changed, so a component that reads it re-renders only for a real change.
 */
export function createConnectionStore(connect: () => ConnectionClient): ConnectionStore {
  let snapshot: ConnectionSnapshot = { state: { status: "connecting" }, daemonVersion: null };
  const listeners = new Set<() => void>();
  let active: { client: ConnectionClient; off: () => void } | undefined;

  function update(state: ConnectionState, daemonVersion: string | null): void {
    if (sameState(state, snapshot.state) && daemonVersion === snapshot.daemonVersion) {
      return;
    }
    snapshot = { state, daemonVersion };
    for (const listener of listeners) {
      listener();
    }
  }

  async function readVersion(client: ConnectionClient): Promise<void> {
    try {
      const status = await client.status();
      if (active?.client === client) {
        update(snapshot.state, status.version);
      }
    } catch {
      // The version is a label. Keep the last one.
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    start() {
      if (active) {
        return;
      }
      const client = connect();
      const off = client.onState((state) => {
        update(state, snapshot.daemonVersion);
        if (state.status === "connected") {
          void readVersion(client);
        }
      });
      active = { client, off };
      update(client.state, snapshot.daemonVersion);
      if (client.state.status === "connected") {
        void readVersion(client);
      }
    },
    stop() {
      if (!active) {
        return;
      }
      const { client, off } = active;
      active = undefined;
      off();
      client.close();
    },
  };
}
