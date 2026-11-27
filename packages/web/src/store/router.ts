import { createStore, type StoreSource } from "./create-store.ts";

export type Route =
  | { name: "home" }
  | { name: "session"; id: string; inspect: Inspect | null; /** Set when the session is a helper, opened as a chat: the lead it came from. */ lead?: string }
  | { name: "trace"; id: string; span: string | null }
  | { name: "settings"; section: string }
  | { name: "routines" }
  | { name: "routine-new"; starter: string | null }
  | { name: "routine"; routine: string; folder: string | null }
  | { name: "data" }
  | { name: "data-source"; source: string; tab: DataTab }
  | { name: "workflows" }
  | { name: "workflow"; id: string }
  | { name: "runs" }
  | { name: "run"; id: string }
  | { name: "welcome"; step: WelcomeStep; from: "send" | null }
  | { name: "not-found" };

/** The tabs of a data source's page, in order. */
export const DATA_TABS = ["tables", "rows", "notes", "queries", "settings"] as const;
export type DataTab = (typeof DATA_TABS)[number];

/** The steps of `/welcome`, in order. */
export const WELCOME_STEPS = ["engine", "model", "tools", "ready"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

/** The inspector beside a chat: open, with `span` selected when not null. */
export type Inspect = { span: string | null };

/** The section `/settings` opens. */
export const DEFAULT_SETTINGS_SECTION = "info";

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
 * `/routines` is the routines page with none picked, `/routines/:routine` one routine (name decoded, no further `/`),
 * and `?folder=` in `search` names the project of a project routine. `/routines?new` is the form for a new routine,
 * and `?new=<starter>` fills it from a starter.
 * `/workflows` is the workflows page with none picked, and `/workflows/:id` one workflow (its id, `<path>::<name>`, decoded).
 * `/runs` is the Runs page: what needs you, what is running, and what ran. `/runs/:id` is one workflow run, by its `workflow_run_id` (decoded, not empty).
 * `/data` is the Data page with none picked, and `/data/:name` one source (name decoded, no further `/`); `?tab=` names its tab (tables when missing or unknown).
 * `/welcome` is first run: `?step=engine|model|tools|ready` (engine when missing or unknown) and `?from=send`.
 * On `/s/:id`, `?inspect` opens the inspector panel and `?inspect=<span>` opens it at that span.
 */
export function parseRoute(pathname: string, search = ""): Route {
  if (pathname === "/") {
    return { name: "home" };
  }
  if (pathname === "/welcome") {
    const params = new URLSearchParams(search);
    const asked = params.get("step");
    const step = WELCOME_STEPS.find((each) => each === asked) ?? "engine";
    return { name: "welcome", step, from: params.get("from") === "send" ? "send" : null };
  }
  if (pathname === "/settings") {
    return { name: "settings", section: DEFAULT_SETTINGS_SECTION };
  }
  if (pathname === "/routines") {
    const make = new URLSearchParams(search).get("new");
    return make === null ? { name: "routines" } : { name: "routine-new", starter: make === "" ? null : make };
  }
  if (pathname === "/runs") {
    return { name: "runs" };
  }
  const run = /^\/runs\/([^/]+)$/.exec(pathname)?.[1];
  if (run !== undefined) {
    try {
      const id = decodeURIComponent(run);
      if (id !== "") return { name: "run", id };
    } catch {
      // A malformed escape is not a run.
    }
  }
  if (pathname === "/data") {
    return { name: "data" };
  }
  const matched = /^\/data\/([^/]+)$/.exec(pathname)?.[1];
  if (matched !== undefined) {
    try {
      const name = decodeURIComponent(matched);
      if (name !== "" && !name.includes("/")) {
        const asked = new URLSearchParams(search).get("tab");
        return { name: "data-source", source: name, tab: DATA_TABS.find((tab) => tab === asked) ?? "tables" };
      }
    } catch {
      // A malformed escape is not a source.
    }
  }
  if (pathname === "/workflows") {
    return { name: "workflows" };
  }
  const workflow = /^\/workflows\/([^/]+)$/.exec(pathname)?.[1];
  if (workflow !== undefined) {
    try {
      const id = decodeURIComponent(workflow);
      if (id !== "") return { name: "workflow", id };
    } catch {
      // A malformed escape is not a workflow.
    }
  }
  const routine = /^\/routines\/([^/]+)$/.exec(pathname)?.[1];
  if (routine !== undefined) {
    try {
      const name = decodeURIComponent(routine);
      if (name !== "" && !name.includes("/")) {
        const folder = new URLSearchParams(search).get("folder");
        return { name: "routine", routine: name, folder: folder === null || folder === "" ? null : folder };
      }
    } catch {
      // A malformed escape is not a routine.
    }
  }
  const section = /^\/settings\/([a-z-]+)$/.exec(pathname)?.[1];
  if (section !== undefined) {
    // `setup` was renamed `info`: old links and bookmarks still land on it.
    // `keys` was renamed `models` when the keys moved onto the provider list.
    return { name: "settings", section: section === "setup" ? "info" : section === "keys" ? "models" : section };
  }
  const match = /^\/s\/([^/]+)(\/trace)?$/.exec(pathname);
  if (match?.[1] !== undefined) {
    try {
      const id = decodeURIComponent(match[1]);
      if (id !== "" && !id.includes("/")) {
        const params = new URLSearchParams(search);
        if (match[2] === undefined) {
          const inspect = params.get("inspect");
          const lead = params.get("lead");
          return {
            name: "session",
            id,
            inspect: inspect === null ? null : { span: inspect === "" ? null : inspect },
            ...(lead === null || lead === "" ? {} : { lead }),
          };
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

/** The path of a helper session as a chat of its own, with the lead it came from. */
export function helperPath(id: string, lead: string): string {
  return `${sessionPath(id)}?lead=${encodeURIComponent(lead)}`;
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

/** The path of the routines page, or of one routine on it. A project routine names its project. */
export function routinePath(name?: string, folder?: string | null): string {
  if (name === undefined) return "/routines";
  const base = `/routines/${encodeURIComponent(name)}`;
  return folder === undefined || folder === null ? base : `${base}?folder=${encodeURIComponent(folder)}`;
}

/** The path of the workflows page, or of one workflow on it. */
export function workflowPath(id?: string): string {
  return id === undefined ? "/workflows" : `/workflows/${encodeURIComponent(id)}`;
}

/** The path of the Data page, or of one source on it, at a tab other than the first. */
export function dataPath(name?: string, tab: DataTab = "tables"): string {
  if (name === undefined) return "/data";
  const base = `/data/${encodeURIComponent(name)}`;
  return tab === "tables" ? base : `${base}?tab=${tab}`;
}

/** The path of the Runs page. */
export function runsPath(): string {
  return "/runs";
}

/** The path of one workflow run, by its `workflow_run_id`. */
export function runPath(workflowRunId: string): string {
  return `/runs/${encodeURIComponent(workflowRunId)}`;
}

/** The path of the form for a new routine, filled from `starter` when given. */
export function routineNewPath(starter?: string | null): string {
  return starter === undefined || starter === null ? "/routines?new" : `/routines?new=${encodeURIComponent(starter)}`;
}

/** The path of `/welcome` at a step. The first step and no origin are the bare path. */
export function welcomePath(step: WelcomeStep = "engine", from: "send" | null = null): string {
  const params = new URLSearchParams();
  if (step !== "engine") params.set("step", step);
  if (from !== null) params.set("from", from);
  const query = params.toString();
  return query === "" ? "/welcome" : `/welcome?${query}`;
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.name === "session") {
    return b.name === "session" && a.id === b.id && a.inspect?.span === b.inspect?.span && (a.inspect === null) === (b.inspect === null);
  }
  if (a.name === "trace") return b.name === "trace" && a.id === b.id && a.span === b.span;
  if (a.name === "welcome") return b.name === "welcome" && a.step === b.step && a.from === b.from;
  if (a.name === "routine-new") return b.name === "routine-new" && a.starter === b.starter;
  if (a.name === "run") return b.name === "run" && a.id === b.id;
  if (a.name === "data-source") return b.name === "data-source" && a.source === b.source && a.tab === b.tab;
  if (a.name === "workflow") return b.name === "workflow" && a.id === b.id;
  if (a.name === "routine") return b.name === "routine" && a.routine === b.routine && a.folder === b.folder;
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
