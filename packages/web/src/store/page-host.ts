import { createStore, type StoreSource } from "./create-store.ts";

/** What the page knows of the gateway that serves it. `null` means unknown. */
export type PageHostSnapshot = { kept: boolean | null; version: string | null };

export type PageHostStore = StoreSource<PageHostSnapshot> & {
  /** Reads `/healthz` again. It never throws; a failed read leaves the snapshot unknown. */
  refresh(): Promise<void>;
};

const UNKNOWN: PageHostSnapshot = { kept: null, version: null };

/** The snapshot a `/healthz` body says. Anything that is not an object with a boolean `kept` is unknown. */
export function readPageHost(body: unknown): PageHostSnapshot {
  if (typeof body !== "object" || body === null) {
    return UNKNOWN;
  }
  const { kept, version } = body as { kept?: unknown; version?: unknown };
  if (typeof kept !== "boolean") {
    return UNKNOWN;
  }
  return { kept, version: typeof version === "string" ? version : null };
}

function same(a: PageHostSnapshot, b: PageHostSnapshot): boolean {
  return a.kept === b.kept && a.version === b.version;
}

async function readHealthz(): Promise<unknown> {
  const res = await fetch("/healthz", { cache: "no-store" });
  return res.json();
}

/**
 * Whether a job keeps the gateway running, as the gateway itself reports it. The page cannot see
 * a launchd job, so it asks `/healthz` on its own origin. An older gateway sends no `kept`.
 */
export function createPageHost(read: () => Promise<unknown> = readHealthz): PageHostStore {
  const store = createStore<PageHostSnapshot>(UNKNOWN);
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    async refresh() {
      let next = UNKNOWN;
      try {
        next = readPageHost(await read());
      } catch {
        // No answer: the UI shows nothing about it.
      }
      if (!same(next, store.getSnapshot())) {
        store.set(next);
      }
    },
  };
}
