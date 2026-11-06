import { createStore, type StoreSource } from "./create-store.ts";

export type Route =
  | { name: "home" }
  | { name: "session"; id: string }
  | { name: "settings"; section: string }
  | { name: "not-found" };

/** The section `/settings` opens. */
export const DEFAULT_SETTINGS_SECTION = "setup";

export type Router = StoreSource<Route> & {
  navigate(path: string, options?: { replace?: boolean }): void;
  /** Stop listening to back and forward. */
  stop(): void;
};

/**
 * `/` is home, `/s/:id` a session (id decoded, not empty, no further `/`), `/settings` and
 * `/settings/:section` (lowercase letters and dashes) the settings page, anything else is not found.
 * The router does not know which sections exist; the page says so for a name it does not list.
 */
export function parseRoute(pathname: string): Route {
  if (pathname === "/") {
    return { name: "home" };
  }
  if (pathname === "/settings") {
    return { name: "settings", section: DEFAULT_SETTINGS_SECTION };
  }
  const section = /^\/settings\/([a-z-]+)$/.exec(pathname)?.[1];
  if (section !== undefined) {
    return { name: "settings", section };
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

/** The path of a settings section. The default section is `/settings`. */
export function settingsPath(section: string = DEFAULT_SETTINGS_SECTION): string {
  return section === DEFAULT_SETTINGS_SECTION ? "/settings" : `/settings/${section}`;
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.name === "session") return b.name === "session" && a.id === b.id;
  if (a.name === "settings") return b.name === "settings" && a.section === b.section;
  return a.name === b.name;
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
