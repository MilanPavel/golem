import { createStore, type StoreSource } from "./create-store.ts";

export type Route = { name: "home" } | { name: "session"; id: string } | { name: "not-found" };

export type Router = StoreSource<Route> & {
  navigate(path: string, options?: { replace?: boolean }): void;
  /** Stop listening to back and forward. */
  stop(): void;
};

/** `/` is home, `/s/:id` a session (id decoded, not empty, no further `/`), anything else is not found. */
export function parseRoute(pathname: string): Route {
  if (pathname === "/") {
    return { name: "home" };
  }
  const match = /^\/s\/([^/]+)$/.exec(pathname);
  if (match?.[1] !== undefined) {
    try {
      const id = decodeURIComponent(match[1]);
      if (id !== "" && !id.includes("/")) {
        return { name: "session", id };
      }
    } catch {
      // A malformed escape is not a session.
    }
  }
  return { name: "not-found" };
}

/** The path for a route's `navigate`. */
export function sessionPath(id: string): string {
  return `/s/${encodeURIComponent(id)}`;
}

function sameRoute(a: Route, b: Route): boolean {
  return a.name === b.name && (a.name !== "session" || (b.name === "session" && a.id === b.id));
}

/** The current route, from `location` and the history. */
export function createRouter(): Router {
  const store = createStore<Route>(parseRoute(location.pathname));

  function sync(): void {
    const next = parseRoute(location.pathname);
    if (!sameRoute(next, store.getSnapshot())) {
      store.set(next);
    }
  }

  window.addEventListener("popstate", sync);
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    navigate(path, options) {
      if (options?.replace) {
        history.replaceState(null, "", path);
      } else {
        history.pushState(null, "", path);
      }
      sync();
    },
    stop() {
      window.removeEventListener("popstate", sync);
    },
  };
}
