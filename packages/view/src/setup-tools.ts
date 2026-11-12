import type { McpAddParams, McpCatalogEntry } from "@golem/client";

import { entryAvailable, entryInputs, entryParams, findEntry, inputDefault, missingRuntime } from "./mcp-catalog.ts";
import { appendInstallOutput } from "./ollama-install.ts";
import { move, type Choice, type Mark, type MoveKey, type SetupLine, type SetupResult } from "./setup-window.ts";

/**
 * The Tools panel of the setup window: the starter MCP servers offered, with what each
 * needs, the ticks, the token a server asks for, and each row's progress while it is added.
 * The model is pure and has no layout: the terminal and the browser draw `toolsLines` or the
 * state itself, and do the work an effect names. Every server is added `on_demand` (the
 * daemon's catalog add does that), so none costs a token until a chat turns it on.
 */

export type ToolsRuntime = "node" | "uv";

/** A row's progress. `idle` is before Enter, and `skipped` is a row the user dropped. */
export type ToolsRowStatus =
  | { kind: "idle" }
  | { kind: "waiting" }
  /** `tail` is the newest line of `runtime.install`'s output. */
  | { kind: "installing"; runtime: ToolsRuntime; tail: string }
  | { kind: "adding" }
  /** `tools` is null for a server that was there before, whose tools are not counted. */
  | { kind: "added"; tools: number | null }
  | { kind: "failed"; hint: string }
  | { kind: "skipped" };

export type ToolsRow = {
  id: string;
  name: string;
  title: string;
  description: string;
  /** The program the machine lacks and the server needs. */
  missing: ToolsRuntime | null;
  /** Whether the server asks for a secret (a token). */
  needsToken: boolean;
  /** How to make the token, when the catalog says. */
  tokenHint: string | null;
  ticked: boolean;
  /** The token typed for this row. Kept only until the add that uses it. Never shown or logged. */
  token: string | null;
  /** Already there before the panel opened. Shown as done, and not added again. */
  already: boolean;
  status: ToolsRowStatus;
  entry: McpCatalogEntry;
};

export type ToolsState = {
  mode: "guided" | "single";
  /** `offer` is the list, `token` the field under it, `run` the adding and what follows. */
  phase: "offer" | "token" | "run";
  rows: readonly ToolsRow[];
  selected: number;
  /** The row whose token is being typed, in `token`. */
  tokenFor: string | null;
};

/** The one entry that is offered but not ticked: it needs a token to be of use. */
const UNTICKED_ID = "github";

function needsSecret(entry: McpCatalogEntry): boolean {
  return entryInputs(entry).some((input) => input.kind === "secret" && input.required !== false);
}

/** A starter that needs nothing a person must type besides secrets. */
function offerable(entry: McpCatalogEntry): boolean {
  if (!entryAvailable(entry)) {
    return false;
  }
  return entryInputs(entry).every(
    (input) => input.kind === "secret" || input.required === false || inputDefault(input, "").length > 0,
  );
}

/**
 * The offer from `mcp.catalog`: the entries marked `starter`, then GitHub unticked. In single
 * mode a server that is already added shows as done.
 */
export function toolsOffer(catalog: readonly McpCatalogEntry[], mode: ToolsState["mode"]): ToolsState {
  const picked = catalog.filter((entry) => entry.starter === true && entry.id !== UNTICKED_ID);
  const github = findEntry(catalog, UNTICKED_ID);
  const entries = github === null ? picked : [...picked, github];
  const rows = entries
    .filter((entry) => offerable(entry) && (entry.added !== true || mode === "single"))
    .map((entry): ToolsRow => {
      const already = entry.added === true;
      const secret = entryInputs(entry).find((input) => input.kind === "secret");
      return {
        id: entry.id,
        name: entry.name,
        title: entry.title,
        description: entry.description,
        missing: missingRuntime(entry),
        needsToken: needsSecret(entry),
        tokenHint: secret?.hint ?? null,
        ticked: already || (entry.id !== UNTICKED_ID && !needsSecret(entry)),
        token: null,
        already,
        status: already ? { kind: "added", tools: null } : { kind: "idle" },
        entry,
      };
    });
  return { mode, phase: "offer", rows, selected: 0, tokenFor: null };
}

/** What a row needs, for the list: `needs Node`, `needs a token`. */
export function toolsNeeds(row: ToolsRow): string[] {
  const needs: string[] = [];
  if (row.missing !== null) {
    needs.push(`needs ${row.missing === "node" ? "Node" : "uv"}`);
  }
  if (row.needsToken) {
    needs.push("needs a token");
  }
  return needs;
}

function setRow(state: ToolsState, id: string, change: (row: ToolsRow) => ToolsRow): ToolsState {
  return { ...state, rows: state.rows.map((row) => (row.id === id ? change(row) : row)) };
}

function pickable(row: ToolsRow): boolean {
  return !row.already;
}

/** Rows that Enter would add: ticked, not there already, and (when a token is needed) given one. */
export function toolsToAdd(state: ToolsState): ToolsRow[] {
  return state.rows.filter((row) => pickable(row) && row.ticked && (!row.needsToken || row.token !== null));
}

export function toolsMoved(state: ToolsState, key: MoveKey): ToolsState {
  return state.phase === "offer" ? { ...state, selected: move(state.selected, state.rows.length, key) } : state;
}

/**
 * Space on a row. Ticking a server that needs a token opens its field; unticking drops the
 * token. A row that is already added does not change.
 */
export function toolsTick(state: ToolsState, id: string): ToolsState {
  const row = state.rows.find((each) => each.id === id);
  if (row === undefined || !pickable(row) || state.phase !== "offer") {
    return state;
  }
  if (row.ticked) {
    return setRow(state, id, (each) => ({ ...each, ticked: false, token: null }));
  }
  if (row.needsToken && row.token === null) {
    return { ...state, phase: "token", tokenFor: id };
  }
  return setRow(state, id, (each) => ({ ...each, ticked: true }));
}

/** Enter in the token field. An empty token skips that server: it stays unticked. */
export function toolsSetToken(state: ToolsState, id: string, token: string): ToolsState {
  const given = token.trim();
  const back: ToolsState = { ...state, phase: "offer", tokenFor: null };
  if (state.rows.find((row) => row.id === id) === undefined) {
    return back;
  }
  return setRow(back, id, (row) =>
    given.length === 0 ? { ...row, ticked: false, token: null } : { ...row, ticked: true, token: given },
  );
}

/** Esc in the token field. */
export function toolsTokenCancelled(state: ToolsState): ToolsState {
  return state.phase === "token" ? { ...state, phase: "offer", tokenFor: null } : state;
}

/** Enter on the offer: every row to add waits, and the run starts. Null when nothing is ticked. */
export function toolsStart(state: ToolsState): ToolsState | null {
  const ids = new Set(toolsToAdd(state).map((row) => row.id));
  if (state.phase !== "offer" || ids.size === 0) {
    return null;
  }
  return {
    ...state,
    phase: "run",
    selected: 0,
    rows: state.rows.map((row) => (ids.has(row.id) ? { ...row, status: { kind: "waiting" } } : row)),
  };
}

/** The work for the UI to do next. */
export type ToolsEffect =
  | { kind: "none" }
  /** `runtime.install` for this program, then `toolsRuntimeDone`. */
  | { kind: "install"; runtime: ToolsRuntime }
  /** `mcp.add` with these params, then `toolsAdded` or `toolsFailed`. */
  | { kind: "add"; id: string; params: McpAddParams };

/** The next effect, one at a time: a waiting row whose runtime is missing installs it first. */
export function toolsStep(state: ToolsState): { state: ToolsState; effect: ToolsEffect } {
  const none = { state, effect: { kind: "none" } } as const;
  if (state.phase !== "run" || state.rows.some((row) => row.status.kind === "installing" || row.status.kind === "adding")) {
    return none;
  }
  const row = state.rows.find((each) => each.status.kind === "waiting");
  if (row === undefined) {
    return none;
  }
  if (row.missing !== null) {
    const runtime = row.missing;
    return {
      state: setRow(state, row.id, (each) => ({ ...each, status: { kind: "installing", runtime, tail: "" } })),
      effect: { kind: "install", runtime },
    };
  }
  const values: Record<string, string> = {};
  for (const input of entryInputs(row.entry)) {
    values[input.id] = input.kind === "secret" ? (row.token ?? "") : inputDefault(input, "");
  }
  return {
    state: setRow(state, row.id, (each) => ({ ...each, status: { kind: "adding" } })),
    effect: { kind: "add", id: row.id, params: entryParams(row.entry, values) },
  };
}

/** A line of `runtime.install`'s output: the newest one shows on the row that waits for it. */
export function toolsRuntimeOutput(state: ToolsState, runtime: ToolsRuntime, text: string): ToolsState {
  return {
    ...state,
    rows: state.rows.map((row) => {
      if (row.status.kind !== "installing" || row.status.runtime !== runtime) {
        return row;
      }
      const tail = appendInstallOutput({ last: row.status.tail, partial: "" }, text).last;
      return { ...row, status: { ...row.status, tail } };
    }),
  };
}

/** The install ended. Success lets the rows that wait for it be added; failure fails them. */
export function toolsRuntimeDone(state: ToolsState, runtime: ToolsRuntime, ok: boolean, reason: string | null): ToolsState {
  const name = runtime === "node" ? "Node" : "uv";
  return {
    ...state,
    rows: state.rows.map((row) => {
      if (row.missing !== runtime || (row.status.kind !== "installing" && row.status.kind !== "waiting")) {
        return row;
      }
      return ok
        ? { ...row, missing: null, status: { kind: "waiting" } }
        : { ...row, status: { kind: "failed", hint: reason ?? `${name} did not install` } };
    }),
  };
}

export function toolsAdded(state: ToolsState, id: string, tools: number): ToolsState {
  // The token has done its job: the Keychain has it now.
  return setRow(state, id, (row) => ({ ...row, token: null, status: { kind: "added", tools } }));
}

/** `hint` is the one line `mcp.test` gives, or the daemon's reason. */
export function toolsFailed(state: ToolsState, id: string, hint: string): ToolsState {
  return setRow(state, id, (row) => ({ ...row, token: null, status: { kind: "failed", hint } }));
}

/** Retry a failed row, with a new token when it needs one. */
export function toolsRetry(state: ToolsState, id: string, token: string | null): ToolsState {
  return setRow(state, id, (row) => {
    if (row.status.kind !== "failed") {
      return row;
    }
    const given = token?.trim() ?? "";
    if (row.needsToken && given.length === 0 && row.token === null) {
      return row;
    }
    return { ...row, token: given.length > 0 ? given : row.token, status: { kind: "waiting" } };
  });
}

/** Drop one row: it is not added, and a waiting or failed row stops asking. */
export function toolsSkipRow(state: ToolsState, id: string): ToolsState {
  return setRow(state, id, (row) =>
    row.status.kind === "waiting" || row.status.kind === "failed" || row.status.kind === "idle"
      ? { ...row, ticked: false, token: null, status: { kind: "skipped" } }
      : row,
  );
}

function busy(row: ToolsRow): boolean {
  return row.status.kind === "waiting" || row.status.kind === "installing" || row.status.kind === "adding";
}

/** Whether every row of a run has ended, with a result or a failure. */
export function toolsSettled(state: ToolsState): boolean {
  return state.phase === "run" && !state.rows.some(busy);
}

/** Rows that failed and still wait for a choice. */
export function toolsFailures(state: ToolsState): ToolsRow[] {
  return state.rows.filter((row) => row.status.kind === "failed");
}

/** What the panel reports: done when the run ended and nothing failed, else it waits. */
export function toolsResult(state: ToolsState): SetupResult | null {
  return toolsSettled(state) && toolsFailures(state).length === 0 ? { kind: "done" } : null;
}

/** Skip, from the offer or after a failure: the window moves on and the added ones stay. */
export const TOOLS_SKIP: SetupResult = { kind: "skip" };

/** What the failed row offers (H5). The log is the UI's to show. */
export function toolsFailureChoices(row: ToolsRow): Choice<"token" | "retry" | "skip" | "log">[] {
  return [
    row.needsToken
      ? { id: "token", label: "Paste a new token", detail: "" }
      : { id: "retry", label: `Try ${row.title} again`, detail: "" },
    { id: "skip", label: `Skip ${row.title}`, detail: "" },
    { id: "log", label: "Show the log", detail: "" },
  ];
}

/** The row's progress as one line: `waiting`, `installing Node`, `adding`, `added · 2 tools · on demand`, `failed · <hint>`. */
export function toolsStatusText(row: ToolsRow): string {
  const status = row.status;
  switch (status.kind) {
    case "idle":
      return "";
    case "waiting":
      return row.missing === null ? "waiting" : `waiting · needs ${row.missing === "node" ? "Node" : "uv"}`;
    case "installing":
      return status.tail.length > 0
        ? `installing ${status.runtime === "node" ? "Node" : "uv"} · ${status.tail}`
        : `installing ${status.runtime === "node" ? "Node" : "uv"}`;
    case "adding":
      return "adding";
    case "added": {
      if (status.tools === null) {
        return "added";
      }
      const count = `${status.tools} tool${status.tools === 1 ? "" : "s"}`;
      return `added · ${count} · on demand`;
    }
    case "failed":
      return `failed · ${status.hint}`;
    case "skipped":
      return "skipped";
  }
}

const STATUS_MARKS: Record<ToolsRowStatus["kind"], Mark | null> = {
  idle: null,
  waiting: "attn",
  installing: "spin",
  adding: "spin",
  added: "ok",
  failed: "fail",
  skipped: "attn",
};

/** The panel's lines. The token field shows dots, never the token. */
export function toolsLines(state: ToolsState, tokenTyped = 0): SetupLine[] {
  if (state.phase === "token") {
    const row = state.rows.find((each) => each.id === state.tokenFor);
    return [
      { kind: "title", text: `${row?.title ?? "Server"} · token` },
      { kind: "blank" },
      { kind: "text", text: "Paste a token:" },
      { kind: "field", text: "•".repeat(tokenTyped) },
      { kind: "blank" },
      ...(row?.tokenHint == null ? [] : [{ kind: "text", text: row.tokenHint, dim: true } as const]),
      { kind: "text", text: "Stored in your Keychain, never in a file.", dim: true },
    ];
  }
  if (state.phase === "offer") {
    const added = state.rows.filter((row) => row.already).length;
    const title = state.mode === "single" ? `Tools · ${added} server${added === 1 ? "" : "s"}` : "Give golem some tools?";
    return [
      { kind: "title", text: title },
      ...(state.mode === "guided" ? [{ kind: "text", text: "They cost nothing until a chat turns one on.", dim: true } as const] : []),
      { kind: "blank" },
      ...state.rows.map((row, index): SetupLine => {
        const needs = toolsNeeds(row);
        const detail = row.already ? "added" : [row.description, ...needs].join(" · ");
        return { kind: "option", label: `[${row.ticked ? "x" : " "}] ${row.title}`, detail, selected: index === state.selected };
      }),
    ];
  }
  const shown = state.rows.filter((row) => row.status.kind !== "idle");
  return shown.map((row): SetupLine => ({
    kind: "row",
    mark: STATUS_MARKS[row.status.kind] ?? "attn",
    label: row.title,
    text: toolsStatusText(row),
  }));
}
