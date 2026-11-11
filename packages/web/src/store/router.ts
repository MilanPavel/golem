import { createStore, type StoreSource } from "./create-store.ts";

export type Route =
  | { name: "home" }
  | { name: "session"; id: string; inspect: Inspect | null }
  | { name: "trace"; id: string; span: string | null }
  | { name: "settings"; section: string }
  | { name: "not-found" };

/** The inspector beside a chat: open, with `span` selected when not null. */
export type Inspect = { span: string | null };

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
 * `/s/:id/trace` is a session's trace, and `?span=` in `search` names the selected span.
 * On `/s/:id`, `?inspect` opens the inspector panel and `?inspect=<span>` opens it at that span.
 */
export function parseRoute(pathname: string, search = ""): Route {
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
  const match = /^\/s\/([^/]+)(\/trace)?$/.exec(pathname);
  if (match?.[1] !== undefined) {
    try {
      const id = decodeURIComponent(match[1]);
      if (id !== "" && !id.includes("/")) {
        const params = new URLSearchParams(search);
        if (match[2] === undefined) {
          const inspect = params.get("inspect");
          return { name: "session", id, inspect: inspect === null ? null : { span: inspect === "" ? null : inspect } };
        }
        const span = params.get("span");
        return { name: "trace", id, span: span === null || span === "" ? null : span };
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

/** The path of a session with the inspector open, at `span` when given. */
export function inspectPath(id: string, span?: string | null): string {
  const base = sessionPath(id);
  return span === undefined || span === null ? `${base}?inspect` : `${base}?inspect=${encodeURIComponent(span)}`;
}

/** The path of a session's trace, with `span` selected when given. */
export function tracePath(id: string, span?: string | null): string {
  const base = `${sessionPath(id)}/trace`;
  return span === undefined || span === null ? base : `${base}?span=${encodeURIComponent(span)}`;
}

/** The path of a settings section. The default section is `/settings`. */
export function settingsPath(section: string = DEFAULT_SETTINGS_SECTION): string {
  return section === DEFAULT_SETTINGS_SECTION ? "/settings" : `/settings/${section}`;
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.name === "session") {
    return b.name === "session" && a.id === b.id && a.inspect?.span === b.inspect?.span && (a.inspect === null) === (b.inspect === null);
  }
  if (a.name === "trace") return b.name === "trace" && a.id === b.id && a.span === b.span;
  if (a.name === "settings") return b.name === "settings" && a.section === b.section;
  return a.name === b.name;
}

/** The current route, from `location` and the history. */
export function createRouter(): Router {
  const store = createStore<Route>(parseRoute(location.pathname, location.search));

  function sync(): void {
    const next = parseRoute(location.pathname, location.search);
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
