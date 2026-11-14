import type { McpAddParams, McpServer, McpToolsResult } from "@golem/client";
import {
  detailChoices,
  firstLine,
  formatSeconds,
  formatTokens,
  mcpStatusMark as statusMark,
  mcpStatusWord as statusWord,
  mcpSummary as summary,
  orderedServers,
  ownToolName,
  shortPath,
  signsIn,
  type McpTone,
  entryAvailable,
  entryInputs,
  entryNote,
  entryParams,
  findEntry,
  inputDefault,
  inputError,
  maskKey,
  mcpNameError,
  OTHER_ID,
  otherSpec,
  type McpCatalogEntry,
  type McpCatalogInput,
} from "@golem/view";

import type { Press } from "./keys.ts";

export { detailChoices, orderedServers, type McpTone };

/**
 * `/mcp`: the servers by where they come from, then one server's details and
 * what can be done with it, then its tools. The servers are the app's shared
 * list, kept current by `mcp.server.status`, so this state only says where
 * the user is.
 */
export type McpManagerView =
  | { kind: "list"; selected: number }
  | { kind: "detail"; name: string; project: string | null; selected: number }
  /** `selected` is the tool the cursor is on. */
  | { kind: "tools"; name: string; project: string | null; selected: number }
  /** A test of the saved server. `steps` are the lines of the steps so far; `result` is set at the end. */
  | { kind: "test"; name: string; project: string | null; steps: readonly string[]; result: readonly string[] | null; ok: boolean | null }
  /** The server's log. `lines` is null while it loads, and `offset` is how many lines up from the newest it is scrolled. */
  | { kind: "logs"; name: string; project: string | null; lines: readonly string[] | null; offset: number }
  /** A sign-in. `url` is the address to open, null until the daemon answers; `result` is set when it ends. */
  | { kind: "login"; name: string; project: string | null; url: string | null; result: string | null; ok: boolean | null }
  /** Asks before the server's config and secrets go. `selected` 0 is Remove, 1 is Keep. */
  | { kind: "remove"; name: string; project: string | null; selected: number }
  /** One tool, run by hand. `args` is JSON text. A run is not asked about and not recorded in a chat. */
  | {
      kind: "try";
      name: string;
      project: string | null;
      tool: string;
      args: string;
      phase: "edit" | "running" | "done";
      output: readonly string[];
      failed: boolean;
      error: string | null;
    }
  /** The catalog, then Other, to pick one to add. */
  | { kind: "add"; selected: number; error: string | null }
  /**
   * The inputs of the catalog entry `id`, one at a time, `index` being the one on screen. A secret
   * is never drawn, only masked, and a failed add clears it.
   */
  | { kind: "form"; id: string; index: number; values: Readonly<Record<string, string>>; error: string | null }
  /** `other`: a name, then a command line or a URL. */
  | { kind: "other"; field: "name" | "command"; name: string; command: string; error: string | null }
  /** The call is running; `back` is the screen to return to if it fails. */
  | { kind: "adding"; name: string; back: McpManagerView };

/**
 * `folder` is the session's folder, which a path input starts at. `catalog` is the daemon's list,
 * or null while it loads. `pending` is an id from `/mcp add <id>` that waits for the list.
 */
export type McpManagerState = {
  open: boolean;
  view: McpManagerView;
  tools: McpToolsResult | null;
  folder: string;
  catalog: readonly McpCatalogEntry[] | null;
  pending: string | null;
};

export const closedMcpManager: McpManagerState = {
  open: false,
  view: { kind: "list", selected: 0 },
  tools: null,
  folder: "",
  catalog: null,
  pending: null,
};

/**
 * A digit picks that numbered action on a screen. `add` is the `a` of the list. `text`, `delete`,
 * and `clear` edit the field of a prompt, where digits and letters are text.
 */
export type McpManagerKey =
  | "up"
  | "down"
  | "enter"
  | "back"
  | "add"
  | "space"
  | "delete"
  | "clear"
  | { text: string }
  | number;

export type McpManagerAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "load-tools"; name: string }
  | { kind: "session"; name: string; on: boolean }
  | { kind: "restart"; name: string }
  /** Ask the daemon for the sign-in address, open it, and wait for `mcp.login.done`. */
  | { kind: "login"; name: string }
  | { kind: "logout"; name: string }
  | { kind: "test"; name: string }
  | { kind: "load-logs"; name: string }
  | { kind: "remove"; name: string }
  /** Hide a tool from the model, or show it again: `tools.exclude` of the server. `tool` is the server's own name. */
  | { kind: "toggle-tool"; name: string; tool: string; hide: boolean }
  | { kind: "call"; name: string; tool: string; arguments: Record<string, unknown> }
  | { kind: "set-enabled"; name: string; enabled: boolean | "on_demand" }
  /** Add a server. `params.token`, when set, is a secret: never show or log it. */
  | { kind: "add"; params: McpAddParams };

export type McpManagerLine = {
  text: string;
  /** Drawn before the mark, such as the selection pointer or a label. */
  prefix?: string;
  /** A status mark drawn in its tone, then a space, then the text. */
  mark?: { text: string; tone: McpTone };
  selected?: boolean;
  dim?: boolean;
  bold?: boolean;
};

const LIST_HINT = "↑/↓ to navigate · Enter to open · a to add a server · Esc to close";
const ADD_HINT = "↑/↓ to navigate · Enter to add · Esc to go back";
const PROMPT_HINT = "Enter to add · Esc to go back";
const ADDING_HINT = "Esc is off until the server answers";
const DETAIL_HINT = "↑/↓ to navigate · Enter to select · Esc to go back";
const TOOLS_HINT = "↑/↓ to navigate · Space to hide or show · Enter to try · Esc to go back";
const TEST_HINT = "Esc to go back";
const LOGS_HINT = "↑/↓ to scroll · Esc to go back";
const LOGIN_HINT = "Esc to go back (the sign-in goes on)";
const REMOVE_HINT = "↑/↓ to navigate · Enter to select · Esc to keep it";
const TRY_HINT = "Enter to run · Esc to go back";
const TRY_DONE_HINT = "Enter to run again · Esc to go back";


export function openMcpManager(folder = ""): McpManagerState {
  return { ...closedMcpManager, open: true, folder };
}

/** `/mcp add [id]`: the catalog, once the daemon has sent it, or straight to the step of one entry. */
export function openMcpAdd(folder: string, id: string | null): McpManagerState {
  return { ...openMcpManager(folder), view: { kind: "add", selected: 0, error: null }, pending: id };
}

/**
 * The daemon's list arrived. A pick waiting from `/mcp add <id>` goes to its step, which may add it
 * at once, or says the id is not in the catalog.
 */
export function mcpCatalogLoaded(
  state: McpManagerState,
  catalog: readonly McpCatalogEntry[],
): { state: McpManagerState; action: McpManagerAction } {
  const loaded = { ...state, catalog, pending: null };
  const id = state.pending;
  if (!state.open || id === null || state.view.kind !== "add") {
    return { state: loaded, action: { kind: "none" } };
  }
  const index = id === OTHER_ID ? picks(catalog).length - 1 : catalog.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return { state: { ...loaded, view: { ...state.view, error: `${id} is not in the catalog.` } }, action: { kind: "none" } };
  }
  return pressAdd({ ...loaded, view: { ...state.view, selected: index } }, { ...state.view, selected: index }, "enter", false);
}

/** The catalog's entries, then the one that is not an entry. */
function picks(catalog: readonly McpCatalogEntry[]): (McpCatalogEntry | null)[] {
  return [...catalog, null];
}

/** Whether the screen is a prompt, where a key is text and not a command. */
export function mcpManagerTyping(state: McpManagerState): boolean {
  const view = state.view;
  return state.open && (view.kind === "form" || view.kind === "other" || (view.kind === "try" && view.phase === "edit"));
}

export function mcpManagerKeyOf(press: Press, typing = false): McpManagerKey | null {
  if (press.name === "up" || press.name === "down") {
    return typing ? null : press.name;
  }
  if (press.name === "return") {
    return "enter";
  }
  if (press.name === "escape") {
    return "back";
  }
  if (typing) {
    if (press.name === "backspace") {
      return "delete";
    }
    if (press.name === "ctrl-u" || press.name === "ctrl-w") {
      return "clear";
    }
    const text = press.input.replace(/[\r\n]/g, "");
    if ((press.name === null || press.name === "question") && !press.ctrl && !press.meta && text.length > 0) {
      return { text };
    }
    return null;
  }
  if (!press.ctrl && !press.meta && /^[1-9]$/.test(press.input)) {
    return Number(press.input);
  }
  if (!press.ctrl && !press.meta && press.input === " ") {
    return "space";
  }
  if (!press.ctrl && !press.meta && press.input === "a") {
    return "add";
  }
  return null;
}

/** The server was added: the list, with the new server selected. */
export function mcpAdded(state: McpManagerState, servers: readonly McpServer[], name: string): McpManagerState {
  const index = orderedServers(servers).findIndex((server) => server.name === name && !server.project);
  // A server that waits for a sign-in opens on its detail, where Sign in is the first choice.
  if (servers.some((server) => server.name === name && !server.project && server.state === "needs_auth")) {
    return { ...state, view: { kind: "detail", name, project: null, selected: 0 }, tools: null };
  }
  return { ...state, view: { kind: "list", selected: Math.max(0, index) }, tools: null };
}

/** The call failed: back to the screen it came from, with the daemon's message. Anything else is left alone. */
export function mcpAddFailed(state: McpManagerState, message: string): McpManagerState {
  const view = state.view;
  if (view.kind !== "adding") {
    return state;
  }
  const back = view.back;
  const shown = back.kind === "add" || back.kind === "form" || back.kind === "other" ? { ...back, error: message } : back;
  return { ...state, view: shown };
}

function startEntry(
  state: McpManagerState,
  entry: McpCatalogEntry | null,
  selected: number,
): { state: McpManagerState; action: McpManagerAction } {
  const none = { kind: "none" } as const;
  const stay = (error: string) => ({ state: { ...state, view: { kind: "add", selected, error } as McpManagerView }, action: none });
  if (entry === null) {
    return { state: { ...state, view: { kind: "other", field: "name", name: "", command: "", error: null } }, action: none };
  }
  if (!entryAvailable(entry)) {
    return stay(entry.reason ?? `${entry.title} is not available.`);
  }
  if (entry.added === true) {
    return stay(`${entry.name} is already added. Remove it in /mcp to add it again.`);
  }
  const inputs = entryInputs(entry);
  const values = Object.fromEntries(inputs.map((input) => [input.id, input.kind === "secret" ? "" : inputDefault(input, state.folder)]));
  if (inputs.length > 0) {
    return { state: { ...state, view: { kind: "form", id: entry.id, index: 0, values, error: null } }, action: none };
  }
  const back: McpManagerView = { kind: "add", selected, error: null };
  return { state: { ...state, view: { kind: "adding", name: entry.name, back } }, action: { kind: "add", params: entryParams(entry, values) } };
}

function pressAdd(
  state: McpManagerState,
  view: Extract<McpManagerView, { kind: "add" }>,
  key: McpManagerKey,
  onEmptyList: boolean,
): { state: McpManagerState; action: McpManagerAction } {
  const none = { kind: "none" } as const;
  const list = picks(state.catalog ?? []);
  const selected = clamp(view.selected, list.length);
  if (key === "back") {
    return onEmptyList
      ? { state: closedMcpManager, action: { kind: "close" } }
      : { state: { ...state, view: { kind: "list", selected: 0 } }, action: none };
  }
  if (state.catalog === null) {
    // Nothing to pick until the daemon answers.
    return { state, action: none };
  }
  if (key === "up" || key === "down") {
    const next = clamp(selected + (key === "up" ? -1 : 1), list.length);
    return { state: { ...state, view: { kind: "add", selected: next, error: null } }, action: none };
  }
  const index = key === "enter" ? selected : typeof key === "number" ? key - 1 : -1;
  if (index < 0 || index >= list.length) {
    return { state, action: none };
  }
  return startEntry(state, list[index] ?? null, index);
}

function currentInput(state: McpManagerState, view: Extract<McpManagerView, { kind: "form" }>): {
  entry: McpCatalogEntry;
  input: McpCatalogInput;
} | null {
  const entry = findEntry(state.catalog ?? [], view.id);
  const input = entry === null ? undefined : entryInputs(entry)[view.index];
  return entry === null || input === undefined ? null : { entry, input };
}

function pressForm(
  state: McpManagerState,
  view: Extract<McpManagerView, { kind: "form" }>,
  key: McpManagerKey,
): { state: McpManagerState; action: McpManagerAction } {
  const none = { kind: "none" } as const;
  const at = (next: McpManagerView) => ({ state: { ...state, view: next }, action: none });
  const found = currentInput(state, view);
  if (found === null) {
    return at({ kind: "add", selected: 0, error: null });
  }
  const { entry, input } = found;
  const field = view.values[input.id] ?? "";
  const withField = (value: string): McpManagerView => ({ ...view, values: { ...view.values, [input.id]: value }, error: null });
  if (typeof key === "object") {
    return at(withField(field + key.text));
  }
  if (key === "delete") {
    return at(withField([...field].slice(0, -1).join("")));
  }
  if (key === "clear") {
    return at(withField(""));
  }
  if (key === "back") {
    if (view.index > 0) {
      return at({ ...view, index: view.index - 1, error: null });
    }
    return at({ kind: "add", selected: Math.max(0, (state.catalog ?? []).indexOf(entry)), error: null });
  }
  if (key !== "enter") {
    return { state, action: none };
  }
  const error = inputError(input, field);
  if (error !== null) {
    return at({ ...view, error });
  }
  const inputs = entryInputs(entry);
  if (view.index + 1 < inputs.length) {
    return at({ ...view, index: view.index + 1, error: null });
  }
  // The typed secrets leave the state as the call starts, so a failure asks again.
  const kept = Object.fromEntries(Object.entries(view.values).filter(([id]) => inputs.find((each) => each.id === id)?.kind !== "secret"));
  const back: McpManagerView = { kind: "form", id: view.id, index: inputs.length - 1, values: kept, error: null };
  return {
    state: { ...state, view: { kind: "adding", name: entry.name, back } },
    action: { kind: "add", params: entryParams(entry, view.values) },
  };
}

function pressOther(
  state: McpManagerState,
  view: Extract<McpManagerView, { kind: "other" }>,
  key: McpManagerKey,
): { state: McpManagerState; action: McpManagerAction } {
  const none = { kind: "none" } as const;
  const at = (next: McpManagerView) => ({ state: { ...state, view: next }, action: none });
  const field = view.field === "name" ? view.name : view.command;
  const withField = (value: string): McpManagerView =>
    view.field === "name" ? { ...view, name: value, error: null } : { ...view, command: value, error: null };
  if (typeof key === "object") {
    return at(withField(field + key.text));
  }
  if (key === "delete") {
    return at(withField([...field].slice(0, -1).join("")));
  }
  if (key === "clear") {
    return at(withField(""));
  }
  if (key === "back") {
    if (view.field === "command") {
      return at({ ...view, field: "name", error: null });
    }
    return at({ kind: "add", selected: Math.max(0, (state.catalog ?? []).length), error: null });
  }
  if (key !== "enter") {
    return { state, action: none };
  }
  if (view.field === "name") {
    const name = view.name.trim();
    const error = mcpNameError(name);
    return error === null ? at({ ...view, name, field: "command", error: null }) : at({ ...view, error });
  }
  const spec = otherSpec(view.name, view.command);
  if ("error" in spec) {
    return at({ ...view, error: spec.error });
  }
  const back: McpManagerView = { ...view, error: null };
  return { state: { ...state, view: { kind: "adding", name: view.name, back } }, action: { kind: "add", params: spec.spec } };
}

export function pressMcpManager(
  state: McpManagerState,
  servers: readonly McpServer[],
  key: McpManagerKey,
): { state: McpManagerState; action: McpManagerAction } {
  const none = { kind: "none" } as const;
  const view = state.view;
  const ordered = orderedServers(servers);
  if (view.kind === "adding") {
    return { state, action: none };
  }
  if (view.kind === "add") {
    return pressAdd(state, view, key, false);
  }
  if (view.kind === "form") {
    return pressForm(state, view, key);
  }
  if (view.kind === "other") {
    return pressOther(state, view, key);
  }
  if (view.kind === "list") {
    if (ordered.length === 0) {
      // Nothing to manage: the list is the catalog.
      return pressAdd(state, { kind: "add", selected: view.selected, error: null }, key, true);
    }
    // The last row is "Add a server".
    const rows = ordered.length + 1;
    const selected = clamp(view.selected, rows);
    if (key === "back") {
      return { state: closedMcpManager, action: { kind: "close" } };
    }
    if (key === "add") {
      return { state: { ...state, view: { kind: "add", selected: 0, error: null } }, action: none };
    }
    if (key === "up" || key === "down") {
      const next = clamp(selected + (key === "up" ? -1 : 1), rows);
      return { state: { ...state, view: { kind: "list", selected: next } }, action: none };
    }
    const server = ordered[selected];
    if (key === "enter" && server !== undefined) {
      const detail: McpManagerView = { kind: "detail", name: server.name, project: server.project ?? null, selected: 0 };
      return { state: { ...state, view: detail }, action: none };
    }
    if (key === "enter") {
      return { state: { ...state, view: { kind: "add", selected: 0, error: null } }, action: none };
    }
    return { state, action: none };
  }
  const index = ordered.findIndex((server) => server.name === view.name && (server.project ?? null) === view.project);
  const server = ordered[index];
  const backToList = { ...state, view: { kind: "list", selected: Math.max(0, index) } as McpManagerView, tools: null };
  if (server === undefined) {
    return { state: backToList, action: none };
  }
  if (view.kind === "tools") {
    return pressTools(state, view, key);
  }
  if (view.kind === "try") {
    return pressTry(state, view, key);
  }
  if (view.kind === "test" || view.kind === "logs" || view.kind === "remove" || view.kind === "login") {
    return pressInfo(state, view, key);
  }
  const choices = detailChoices(server, signsIn(server, state.catalog));
  if (key === "back") {
    return { state: backToList, action: none };
  }
  if (key === "up" || key === "down") {
    const selected = clamp(view.selected + (key === "up" ? -1 : 1), choices.length);
    return { state: { ...state, view: { ...view, selected } }, action: none };
  }
  const picked =
    key === "enter" ? choices[clamp(view.selected, choices.length)] : typeof key === "number" ? choices[key - 1] : undefined;
  if (picked === undefined) {
    return { state, action: none };
  }
  const open = (next: McpManagerView, action: McpManagerAction = none) => ({ state: { ...state, view: next }, action });
  if (typeof picked.action === "object" && picked.action.kind === "login") {
    return open({ kind: "login", name: view.name, project: view.project, url: null, result: null, ok: null }, picked.action);
  }
  if (picked.action === "run-test") {
    return open({ kind: "test", name: view.name, project: view.project, steps: [], result: null, ok: null }, { kind: "test", name: view.name });
  }
  if (picked.action === "view-logs") {
    return open({ kind: "logs", name: view.name, project: view.project, lines: null, offset: 0 }, { kind: "load-logs", name: view.name });
  }
  if (picked.action === "ask-remove") {
    return open({ kind: "remove", name: view.name, project: view.project, selected: 1 });
  }
  if (picked.action === "view-tools") {
    const tools: McpManagerView = { kind: "tools", name: view.name, project: view.project, selected: 0 };
    return { state: { ...state, view: tools, tools: null }, action: { kind: "load-tools", name: view.name } };
  }
  return { state, action: picked.action };
}

function toDetail(view: { name: string; project: string | null }): McpManagerView {
  return { kind: "detail", name: view.name, project: view.project, selected: 0 };
}

function pressTools(
  state: McpManagerState,
  view: Extract<McpManagerView, { kind: "tools" }>,
  key: McpManagerKey,
): { state: McpManagerState; action: McpManagerAction } {
  const none = { kind: "none" } as const;
  const tools = state.tools?.tools ?? [];
  if (key === "back") {
    return { state: { ...state, view: toDetail(view) }, action: none };
  }
  if (key === "up" || key === "down") {
    const selected = clamp(view.selected + (key === "up" ? -1 : 1), tools.length);
    return { state: { ...state, view: { ...view, selected } }, action: none };
  }
  const tool = tools[clamp(view.selected, tools.length)];
  if (tool === undefined) {
    return { state, action: none };
  }
  const own = ownToolName(view.name, tool.name);
  if (key === "space") {
    return { state, action: { kind: "toggle-tool", name: view.name, tool: own, hide: tool.hidden !== true } };
  }
  if (key === "enter") {
    const next: McpManagerView = {
      kind: "try",
      name: view.name,
      project: view.project,
      tool: own,
      args: "",
      phase: "edit",
      output: [],
      failed: false,
      error: null,
    };
    return { state: { ...state, view: next }, action: none };
  }
  return { state, action: none };
}

/** `text` as the arguments of a tool call: nothing is `{}`, and anything but an object is an error. */
function parseArguments(text: string): { arguments: Record<string, unknown> } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { arguments: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: 'Arguments are JSON, such as {"path": "/tmp"}.' };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: 'Arguments must be a JSON object, such as {"path": "/tmp"}.' };
  }
  return { arguments: parsed as Record<string, unknown> };
}

function pressTry(
  state: McpManagerState,
  view: Extract<McpManagerView, { kind: "try" }>,
  key: McpManagerKey,
): { state: McpManagerState; action: McpManagerAction } {
  const none = { kind: "none" } as const;
  const at = (next: McpManagerView) => ({ state: { ...state, view: next }, action: none });
  if (key === "back") {
    const selected = Math.max(0, (state.tools?.tools ?? []).findIndex((tool) => ownToolName(view.name, tool.name) === view.tool));
    return at({ kind: "tools", name: view.name, project: view.project, selected });
  }
  if (view.phase === "running") {
    return { state, action: none };
  }
  if (view.phase === "done") {
    return key === "enter" ? at({ ...view, phase: "edit", output: [], failed: false, error: null }) : { state, action: none };
  }
  const withArgs = (args: string): McpManagerView => ({ ...view, args, error: null });
  if (typeof key === "object") {
    return at(withArgs(view.args + key.text));
  }
  if (key === "delete") {
    return at(withArgs([...view.args].slice(0, -1).join("")));
  }
  if (key === "clear") {
    return at(withArgs(""));
  }
  if (key !== "enter") {
    return { state, action: none };
  }
  const parsed = parseArguments(view.args);
  if ("error" in parsed) {
    return at({ ...view, error: parsed.error });
  }
  return {
    state: { ...state, view: { ...view, phase: "running", output: [], failed: false, error: null } },
    action: { kind: "call", name: view.name, tool: view.tool, arguments: parsed.arguments },
  };
}

function pressInfo(
  state: McpManagerState,
  view: Extract<McpManagerView, { kind: "test" | "logs" | "remove" | "login" }>,
  key: McpManagerKey,
): { state: McpManagerState; action: McpManagerAction } {
  const none = { kind: "none" } as const;
  if (key === "back") {
    return { state: { ...state, view: toDetail(view) }, action: none };
  }
  if (view.kind === "logs") {
    if (key === "up" || key === "down") {
      const offset = Math.min(Math.max(0, view.offset + (key === "up" ? 1 : -1)), Math.max(0, (view.lines?.length ?? 0) - 1));
      return { state: { ...state, view: { ...view, offset } }, action: none };
    }
    return { state, action: none };
  }
  if (view.kind === "remove") {
    if (key === "up" || key === "down") {
      return { state: { ...state, view: { ...view, selected: key === "up" ? 0 : 1 } }, action: none };
    }
    const picked = key === "enter" ? view.selected : typeof key === "number" ? key - 1 : -1;
    if (picked === 0) {
      return { state: { ...state, view: { kind: "list", selected: 0 }, tools: null }, action: { kind: "remove", name: view.name } };
    }
    return picked === 1 ? { state: { ...state, view: toDetail(view) }, action: none } : { state, action: none };
  }
  return { state, action: none };
}

/** The daemon gave the address to open for a sign-in. Ignored if the person has left it. */
export function mcpLoginUrl(state: McpManagerState, name: string, url: string): McpManagerState {
  const view = state.view;
  return view.kind === "login" && view.name === name ? { ...state, view: { ...view, url } } : state;
}

/** The sign-in ended, or the call for it failed: `text` is what to say. */
export function mcpLoginDone(state: McpManagerState, name: string, ok: boolean, text: string): McpManagerState {
  const view = state.view;
  return view.kind === "login" && view.name === name ? { ...state, view: { ...view, ok, result: text } } : state;
}

/** A step of a running test ended. Ignored if the person has left the test. */
export function mcpTestStep(state: McpManagerState, name: string, line: string): McpManagerState {
  const view = state.view;
  return view.kind === "test" && view.name === name ? { ...state, view: { ...view, steps: [...view.steps, line] } } : state;
}

/** The test ended: `result` is what it found, drawn under its steps. */
export function mcpTestDone(state: McpManagerState, name: string, ok: boolean, result: readonly string[]): McpManagerState {
  const view = state.view;
  return view.kind === "test" && view.name === name ? { ...state, view: { ...view, ok, result } } : state;
}

export function mcpLogsLoaded(state: McpManagerState, name: string, lines: readonly string[]): McpManagerState {
  const view = state.view;
  return view.kind === "logs" && view.name === name ? { ...state, view: { ...view, lines, offset: 0 } } : state;
}

const LOG_KEPT = 500;

/** New log lines while the log is open. A log scrolled up stays where it is. */
export function mcpLogsAppended(state: McpManagerState, name: string, added: readonly string[]): McpManagerState {
  const view = state.view;
  if (view.kind !== "logs" || view.name !== name || view.lines === null || added.length === 0) {
    return state;
  }
  const lines = [...view.lines, ...added].slice(-LOG_KEPT);
  const offset = view.offset === 0 ? 0 : Math.min(view.offset + added.length, lines.length - 1);
  return { ...state, view: { ...view, lines, offset } };
}

/** A tool call ended, with its text, or with the message of why it could not run. */
export function mcpCallDone(
  state: McpManagerState,
  name: string,
  tool: string,
  result: { text: string; failed: boolean } | { error: string },
): McpManagerState {
  const view = state.view;
  if (view.kind !== "try" || view.name !== name || view.tool !== tool || view.phase !== "running") {
    return state;
  }
  if ("error" in result) {
    return { ...state, view: { ...view, phase: "edit", error: result.error } };
  }
  const output = result.text.length === 0 ? ["(no text)"] : result.text.split("\n");
  return { ...state, view: { ...view, phase: "done", output, failed: result.failed } };
}

export function layoutMcpManager(input: {
  state: McpManagerState;
  servers: readonly McpServer[] | null;
  error: string | null;
  home: string;
  columns: number;
  rows: number;
}): McpManagerLine[] {
  const { state, home } = input;
  const width = Math.max(1, input.columns);
  const servers = input.servers === null ? null : orderedServers(input.servers);
  let body: McpManagerLine[];
  let hint = LIST_HINT;
  const flow = flowLines(state, width);
  if (flow !== null) {
    body = flow.lines;
    hint = flow.hint;
  } else if (input.error !== null) {
    body = [{ text: "Manage MCP servers", bold: true }, { text: "" }, { text: input.error }];
  } else if (servers === null) {
    body = [{ text: "Manage MCP servers", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else if (state.view.kind === "list") {
    body = listLines(servers, state.view.selected, home, state.catalog);
    hint = servers.length === 0 ? ADD_HINT : LIST_HINT;
  } else {
    const view = state.view;
    if (view.kind === "add" || view.kind === "form" || view.kind === "other" || view.kind === "adding") {
      return [];
    }
    const server = servers.find((item) => item.name === view.name && (item.project ?? null) === view.project);
    const room = Math.max(1, input.rows - 2);
    if (server === undefined) {
      body = listLines(servers, 0, home, state.catalog);
    } else if (view.kind === "detail") {
      body = detailLines(server, view.selected, home, signsIn(server, state.catalog));
      hint = DETAIL_HINT;
    } else if (view.kind === "tools") {
      body = toolLines(server, state.tools, view.selected);
      hint = TOOLS_HINT;
    } else if (view.kind === "test") {
      body = testLines(server, view);
      hint = TEST_HINT;
    } else if (view.kind === "logs") {
      body = logLines(server, view, room);
      hint = LOGS_HINT;
    } else if (view.kind === "login") {
      body = loginLines(server, view, width);
      hint = LOGIN_HINT;
    } else if (view.kind === "remove") {
      body = removeLines(server, view);
      hint = REMOVE_HINT;
    } else {
      body = tryLines(view, room);
      hint = view.phase === "done" ? TRY_DONE_HINT : TRY_HINT;
    }
  }
  const room = Math.max(0, input.rows - 2);
  const lines = [...scrollToSelected(body, room), { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, Math.max(0, input.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}

/** The catalog, numbered, each with its description under it, then Other. */
function catalogLines(selected: number, catalog: readonly McpCatalogEntry[] | null): McpManagerLine[] {
  if (catalog === null) {
    return [{ text: "loading the catalog…", dim: true }];
  }
  const list = picks(catalog);
  const chosen = clamp(selected, list.length);
  return list.flatMap((entry, index): McpManagerLine[] => {
    const off = entry !== null && (!entryAvailable(entry) || entry.added === true);
    return [
      {
        text: `${index + 1}. ${entry === null ? "Other" : entry.title}`,
        prefix: index === chosen ? "❯ " : "  ",
        selected: index === chosen,
        dim: off,
      },
      { text: entry === null ? "Type a name, then a command or a URL." : entryNote(entry), prefix: "     ", dim: true },
    ];
  });
}

/** The screens of adding a server, or null when the view is not one of them. */
function flowLines(state: McpManagerState, width: number): { lines: McpManagerLine[]; hint: string } | null {
  const view = state.view;
  const title: McpManagerLine = { text: "Add an MCP server", bold: true };
  const failure = (error: string | null): McpManagerLine[] =>
    error === null ? [] : [{ text: "" }, { text: error, mark: { text: "✘", tone: "bad" } }];
  if (view.kind === "add") {
    return { lines: [title, { text: "" }, ...catalogLines(view.selected, state.catalog), ...failure(view.error)], hint: ADD_HINT };
  }
  if (view.kind === "adding") {
    return { lines: [title, { text: "" }, { text: `adding ${view.name}…`, dim: true }], hint: ADDING_HINT };
  }
  if (view.kind === "form") {
    const found = currentInput(state, view);
    if (found === null) {
      return { lines: [title, { text: "" }, { text: "that entry is gone", dim: true }], hint: PROMPT_HINT };
    }
    const { entry, input } = found;
    const total = entryInputs(entry).length;
    const value = view.values[input.id] ?? "";
    const lines: McpManagerLine[] = [
      { text: `Add ${entry.title}${total > 1 ? ` · ${view.index + 1} of ${total}` : ""}`, bold: true },
      { text: "" },
      ...(input.hint == null ? [] : wrap(input.hint, width).map((text) => ({ text, dim: true }))),
      ...(input.hint == null ? [] : [{ text: "" }]),
      { text: `${input.label}: ${input.kind === "secret" ? maskKey(value) : value}` },
      ...(input.kind === "secret" ? [{ text: "Stored in your Keychain, never in a file.", dim: true }] : []),
      ...(input.kind === "choice" ? [{ text: `One of: ${(input.choices ?? []).join(", ")}`, dim: true }] : []),
      ...failure(view.error),
    ];
    return { lines, hint: PROMPT_HINT };
  }
  if (view.kind === "other") {
    const lines: McpManagerLine[] = [
      title,
      { text: "" },
      { prefix: view.field === "name" ? "❯ " : "  ", text: `Name:    ${view.name}` },
    ];
    if (view.field === "command") {
      lines.push({ prefix: "❯ ", text: `Command: ${view.command}` });
      lines.push({ text: "A command line, or an https:// URL. For a token, use golem mcp add --token.", dim: true });
    }
    return { lines: [...lines, ...failure(view.error)], hint: PROMPT_HINT };
  }
  return null;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line.length === 0 ? word : `${line} ${word}`;
    }
  }
  return line.length > 0 ? [...lines, line] : lines;
}

function listLines(servers: readonly McpServer[], selected: number, home: string, catalog: readonly McpCatalogEntry[] | null): McpManagerLine[] {
  const lines: McpManagerLine[] = [
    { text: "Manage MCP servers", bold: true },
    { text: `${servers.length} ${servers.length === 1 ? "server" : "servers"}`, dim: true },
  ];
  if (servers.length === 0) {
    return [...lines, { text: "" }, { text: "Add one:", bold: true }, ...catalogLines(selected, catalog)];
  }
  const nameWidth = Math.max(...servers.map((server) => server.name.length));
  const chosen = clamp(selected, servers.length + 1);
  let group: string | null | undefined;
  servers.forEach((server, index) => {
    const source = server.project ?? null;
    if (source !== group) {
      group = source;
      const where = shortPath(server.config ?? (source === null ? "~/.golem/config.toml" : source), home);
      lines.push({ text: "" }, { text: `  ${source === null ? "Yours" : "This project"} (${where})`, bold: true });
    }
    lines.push({
      prefix: index === chosen ? "❯ " : "  ",
      mark: statusMark(server),
      text: `${server.name.padEnd(nameWidth)}  ${summary(server)}`,
      selected: index === chosen,
      dim: server.state === "disabled",
    });
  });
  lines.push(
    { text: "" },
    { text: "+ Add a server", prefix: chosen === servers.length ? "❯ " : "  ", selected: chosen === servers.length },
  );
  return lines;
}

function detailLines(server: McpServer, selected: number, home: string, oauth: boolean): McpManagerLine[] {
  const label = (key: string) => `${key}:`.padEnd(15);
  const isUrl = /^https?:\/\//.test(server.command);
  const count = server.tools?.length ?? 0;
  const lines: McpManagerLine[] = [
    { text: `${server.name} MCP server`, bold: true },
    { text: "" },
    { prefix: label("Status"), mark: statusMark(server), text: statusWord(server) },
    { text: `${label(isUrl ? "URL" : "Command")}${server.command}` },
  ];
  if (server.config) {
    lines.push({ text: `${label("Config")}${shortPath(server.config, home)}` });
  }
  if (server.state === "running") {
    const tokens = server.schema_tokens == null ? "" : ` · ≈${formatTokens(server.schema_tokens)} tokens per prompt`;
    lines.push({ text: `${label("Tools")}${count} ${count === 1 ? "tool" : "tools"}${tokens}` });
  }
  const hidden = server.tools_hidden ?? 0;
  if (hidden > 0) {
    lines.push({ text: `${label("Hidden")}${hidden} ${hidden === 1 ? "tool" : "tools"} kept from the model` });
  }
  if (server.approval === "allow") {
    lines.push({ text: `${label("Approval")}calls run without asking` });
  }
  if (server.approval === "read-only") {
    lines.push({ text: `${label("Approval")}tools the server marks read-only run without asking` });
  }
  if (server.state === "failed") {
    lines.push({ text: `${label("Error")}${server.error ?? "failed"}` });
    if (server.retry_seconds != null) {
      lines.push({ text: `${label("Next try")}in ${formatSeconds(server.retry_seconds)}` });
    }
  }
  if (server.state !== "disabled") {
    const here = server.enabled === true ? "on" : "off";
    lines.push({ text: `${label("In this chat")}${here} · ${server.on_demand ? "on demand" : "every chat"}` });
  }
  const choices = detailChoices(server, oauth);
  const chosen = clamp(selected, choices.length);
  lines.push({ text: "" });
  choices.forEach((choice, index) => {
    const pointer = index === chosen ? "❯ " : "  ";
    lines.push({ text: `${pointer}${index + 1}. ${choice.label}`, selected: index === chosen });
  });
  return lines;
}

function toolLines(server: McpServer, tools: McpToolsResult | null, selected: number): McpManagerLine[] {
  const head: McpManagerLine[] = [{ text: `${server.name} tools`, bold: true }, { text: "" }];
  if (tools === null) {
    return [...head, { text: "loading…", dim: true }];
  }
  if (tools.tools.length === 0) {
    return [...head, { text: "No tools while the server is not running.", dim: true }];
  }
  const names = tools.tools.map((tool) => ownToolName(server.name, tool.name));
  const nameWidth = Math.max(...names.map((name) => name.length));
  const chosen = clamp(selected, tools.tools.length);
  const hidden = tools.tools.filter((tool) => tool.hidden === true).length;
  const lines = tools.tools.map(
    (tool, index): McpManagerLine => ({
      prefix: index === chosen ? "❯ " : "  ",
      mark: tool.hidden === true ? { text: "–", tone: "off" } : { text: "✔", tone: "ok" },
      text: `${(names[index] ?? tool.name).padEnd(nameWidth)}  ${firstLine(tool.description)}`,
      selected: index === chosen,
      dim: tool.hidden === true,
    }),
  );
  const note = hidden === 0 ? [] : [{ text: "" }, { text: `${hidden} hidden from the model (tools.exclude).`, dim: true }];
  return [...head, ...lines, ...note];
}

function testLines(server: McpServer, view: Extract<McpManagerView, { kind: "test" }>): McpManagerLine[] {
  const lines: McpManagerLine[] = [{ text: `Test ${server.name}`, bold: true }, { text: "" }];
  lines.push(...view.steps.map((text) => ({ text })));
  if (view.result === null) {
    return [...lines, { text: "testing…", dim: true }];
  }
  return [
    ...lines,
    { text: "" },
    ...view.result.map((text, index): McpManagerLine =>
      index === 0 ? { text, mark: { text: view.ok === true ? "✔" : "✘", tone: view.ok === true ? "ok" : "bad" } } : { text },
    ),
  ];
}

function loginLines(server: McpServer, view: Extract<McpManagerView, { kind: "login" }>, width: number): McpManagerLine[] {
  const lines: McpManagerLine[] = [{ text: `Sign in to ${server.name}`, bold: true }, { text: "" }];
  if (view.url === null && view.result === null) {
    return [...lines, { text: "asking the daemon…", dim: true }];
  }
  if (view.url !== null) {
    lines.push(
      { text: "Your browser should open. If it does not, open this address (it is on the clipboard):" },
      ...(view.url.match(new RegExp(`.{1,${Math.max(10, width - 2)}}`, "g")) ?? [view.url]).map((text) => ({ text })),
      { text: "" },
    );
  }
  if (view.result === null) {
    return [...lines, { text: "waiting for you to approve golem in the browser…", dim: true }];
  }
  return [...lines, { text: view.result, mark: { text: view.ok === true ? "✔" : "✘", tone: view.ok === true ? "ok" : "bad" } }];
}

function logLines(server: McpServer, view: Extract<McpManagerView, { kind: "logs" }>, room: number): McpManagerLine[] {
  const head: McpManagerLine[] = [{ text: `${server.name} log`, bold: true }, { text: "" }];
  if (view.lines === null) {
    return [...head, { text: "loading…", dim: true }];
  }
  if (view.lines.length === 0) {
    return [...head, { text: "Nothing logged yet.", dim: true }];
  }
  const space = Math.max(1, room - head.length);
  const end = view.lines.length - Math.min(view.offset, view.lines.length - 1);
  return [...head, ...view.lines.slice(Math.max(0, end - space), end).map((text) => ({ text }))];
}

function removeLines(server: McpServer, view: Extract<McpManagerView, { kind: "remove" }>): McpManagerLine[] {
  const choices = [`Remove ${server.name}`, "Keep it"];
  return [
    { text: `Remove ${server.name}?`, bold: true },
    { text: "" },
    { text: "Its entry leaves ~/.golem/config.toml, and the token it stored leaves the Keychain.", dim: true },
    { text: "" },
    ...choices.map((label, index): McpManagerLine => ({
      text: `${index === view.selected ? "❯ " : "  "}${index + 1}. ${label}`,
      selected: index === view.selected,
    })),
  ];
}

function tryLines(view: Extract<McpManagerView, { kind: "try" }>, room: number): McpManagerLine[] {
  const lines: McpManagerLine[] = [
    { text: `Try ${view.tool}`, bold: true },
    { text: "Runs now, without asking. It is not part of any chat.", dim: true },
    { text: "" },
    { prefix: view.phase === "edit" ? "❯ " : "  ", text: `Arguments (JSON): ${view.args}` },
  ];
  if (view.error !== null) {
    lines.push({ text: "" }, { text: view.error, mark: { text: "✘", tone: "bad" } });
  }
  if (view.phase === "running") {
    lines.push({ text: "" }, { text: "running…", dim: true });
  }
  if (view.phase === "done") {
    const space = Math.max(1, room - lines.length - 2);
    const shown = view.output.slice(0, space);
    const more = view.output.length - shown.length;
    lines.push(
      { text: "" },
      { text: view.failed ? "The tool reported an error:" : "Result:", bold: true, ...(view.failed ? { mark: { text: "✘", tone: "bad" as const } } : {}) },
      ...shown.map((text) => ({ text })),
      ...(more > 0 ? [{ text: `… ${more} more ${more === 1 ? "line" : "lines"}`, dim: true }] : []),
    );
  }
  return lines;
}

/** Keep the selected line on screen, with the title lines above it when they fit. */
function scrollToSelected(lines: McpManagerLine[], room: number): McpManagerLine[] {
  if (lines.length <= room) {
    return lines;
  }
  const selected = Math.max(0, lines.findIndex((line) => line.selected === true));
  const start = Math.min(Math.max(0, selected - room + 1), lines.length - room);
  return lines.slice(start, start + room);
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
