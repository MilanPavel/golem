import type { McpAddParams, McpServer, McpToolsResult } from "@golem/client";
import {
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

/**
 * `/mcp`: the servers by where they come from, then one server's details and
 * what can be done with it, then its tools. The servers are the app's shared
 * list, kept current by `mcp.server.status`, so this state only says where
 * the user is.
 */
export type McpManagerView =
  | { kind: "list"; selected: number }
  | { kind: "detail"; name: string; project: string | null; selected: number }
  | { kind: "tools"; name: string; project: string | null; offset: number }
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
  | { kind: "set-enabled"; name: string; enabled: boolean | "on_demand" }
  /** Add a server. `params.token`, when set, is a secret: never show or log it. */
  | { kind: "add"; params: McpAddParams };

export type McpTone = "ok" | "bad" | "wait" | "off";

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
const TOOLS_HINT = "↑/↓ to scroll · Esc to go back";

type DetailChoice = { label: string; action: McpManagerAction | "view-tools" };

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
  return state.open && (state.view.kind === "form" || state.view.kind === "other");
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
  if (!press.ctrl && !press.meta && press.input === "a") {
    return "add";
  }
  return null;
}

/** The server was added: the list, with the new server selected. */
export function mcpAdded(state: McpManagerState, servers: readonly McpServer[], name: string): McpManagerState {
  const index = orderedServers(servers).findIndex((server) => server.name === name && !server.project);
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

/** The user's servers first, then the project's, each sorted by name, as the list shows them. */
export function orderedServers(servers: readonly McpServer[]): McpServer[] {
  const mine = servers.filter((server) => !server.project);
  const project = servers.filter((server) => server.project);
  return [...mine, ...project];
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
    if (key === "back") {
      return { state: { ...state, view: { kind: "detail", name: view.name, project: view.project, selected: 0 } }, action: none };
    }
    if (key === "up" || key === "down") {
      const count = state.tools?.tools.length ?? 0;
      const offset = clamp(view.offset + (key === "up" ? -1 : 1), count);
      return { state: { ...state, view: { ...view, offset } }, action: none };
    }
    return { state, action: none };
  }
  const choices = detailChoices(server);
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
  if (picked.action === "view-tools") {
    const tools: McpManagerView = { kind: "tools", name: view.name, project: view.project, offset: 0 };
    return { state: { ...state, view: tools, tools: null }, action: { kind: "load-tools", name: view.name } };
  }
  return { state, action: picked.action };
}

/** What can be done with `server`, in the order the screen numbers it. */
export function detailChoices(server: McpServer): DetailChoice[] {
  const name = server.name;
  const choices: DetailChoice[] = [];
  if (server.state === "running" && (server.tools?.length ?? 0) > 0) {
    choices.push({ label: "View tools", action: "view-tools" });
  }
  if (server.state === "disabled") {
    choices.push({ label: "Enable for every chat", action: { kind: "set-enabled", name, enabled: true } });
    choices.push({ label: "Enable on demand", action: { kind: "set-enabled", name, enabled: "on_demand" } });
    return choices;
  }
  if (server.on_demand) {
    const on = server.enabled === true;
    choices.push({
      label: on ? "Turn off for this chat" : "Turn on for this chat",
      action: { kind: "session", name, on: !on },
    });
  }
  if (server.state !== "idle") {
    choices.push({ label: "Reconnect", action: { kind: "restart", name } });
  }
  choices.push({ label: "Disable everywhere", action: { kind: "set-enabled", name, enabled: false } });
  return choices;
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
    if (view.kind !== "detail" && view.kind !== "tools") {
      return [];
    }
    const server = servers.find((item) => item.name === view.name && (item.project ?? null) === view.project);
    if (server === undefined) {
      body = listLines(servers, 0, home, state.catalog);
    } else if (view.kind === "detail") {
      body = detailLines(server, view.selected, home);
      hint = DETAIL_HINT;
    } else {
      body = toolLines(server, state.tools, view.offset, input.rows - 2);
      hint = TOOLS_HINT;
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

function detailLines(server: McpServer, selected: number, home: string): McpManagerLine[] {
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
  const choices = detailChoices(server);
  const chosen = clamp(selected, choices.length);
  lines.push({ text: "" });
  choices.forEach((choice, index) => {
    const pointer = index === chosen ? "❯ " : "  ";
    lines.push({ text: `${pointer}${index + 1}. ${choice.label}`, selected: index === chosen });
  });
  return lines;
}

function toolLines(
  server: McpServer,
  tools: McpToolsResult | null,
  offset: number,
  rows: number,
): McpManagerLine[] {
  const head: McpManagerLine[] = [{ text: `${server.name} tools`, bold: true }, { text: "" }];
  if (tools === null) {
    return [...head, { text: "loading…", dim: true }];
  }
  if (tools.tools.length === 0) {
    return [...head, { text: "No tools while the server is not running.", dim: true }];
  }
  const prefix = `mcp__${server.name}__`;
  const names = tools.tools.map((tool) => tool.name.replace(prefix, ""));
  const nameWidth = Math.max(...names.map((name) => name.length));
  const room = Math.max(1, rows - head.length);
  const start = Math.min(clamp(offset, tools.tools.length), Math.max(0, tools.tools.length - room));
  const shown = tools.tools.slice(start, start + room).map((tool, index) => ({
    text: `${(names[start + index] ?? tool.name).padEnd(nameWidth)}  ${firstLine(tool.description)}`,
  }));
  return [...head, ...shown];
}

function summary(server: McpServer): string {
  if (server.state === "running") {
    const count = server.tools?.length ?? 0;
    const tokens = server.schema_tokens == null ? "" : ` · ≈${formatTokens(server.schema_tokens)} tokens`;
    return `${count} ${count === 1 ? "tool" : "tools"}${tokens}${hereNote(server)}`;
  }
  if (server.state === "failed") {
    const retry = server.retry_seconds == null ? "" : ` · retrying in ${formatSeconds(server.retry_seconds)}`;
    return `${server.error ?? "failed"}${retry}`;
  }
  if (server.state === "idle") {
    return `on demand${hereNote(server)}`;
  }
  if (server.state === "disabled") {
    return "disabled";
  }
  return "starting…";
}

function hereNote(server: McpServer): string {
  if (!server.on_demand) {
    return "";
  }
  return server.enabled === true ? " · on here" : " · off here";
}

function statusMark(server: McpServer): { text: string; tone: McpTone } {
  if (server.state === "running") {
    return { text: "✔", tone: "ok" };
  }
  if (server.state === "failed") {
    return { text: "✘", tone: "bad" };
  }
  if (server.state === "starting") {
    return { text: "◌", tone: "wait" };
  }
  return { text: server.state === "idle" ? "○" : "–", tone: "off" };
}

function statusWord(server: McpServer): string {
  if (server.state === "idle") {
    return "idle (on demand)";
  }
  return server.state;
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

function shortPath(path: string, home: string): string {
  return home.length > 0 && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function formatTokens(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`;
}

function formatSeconds(seconds: number): string {
  return seconds < 1 ? "<1s" : `${Math.round(seconds)}s`;
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}
