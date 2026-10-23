import type { McpServer, McpToolsResult } from "@golem/client";

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
  | { kind: "tools"; name: string; project: string | null; offset: number };

export type McpManagerState = { open: boolean; view: McpManagerView; tools: McpToolsResult | null };

export const closedMcpManager: McpManagerState = { open: false, view: { kind: "list", selected: 0 }, tools: null };

/** A digit picks that numbered action on a server's screen. */
export type McpManagerKey = "up" | "down" | "enter" | "back" | number;

export type McpManagerAction =
  | { kind: "none" }
  | { kind: "close" }
  | { kind: "load-tools"; name: string }
  | { kind: "session"; name: string; on: boolean }
  | { kind: "restart"; name: string }
  | { kind: "set-enabled"; name: string; enabled: boolean | "on_demand" };

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

export const MCP_HINT = "Add one to ~/.golem/config.toml as [mcp.<name>] with a command or a url.";
const LIST_HINT = "↑/↓ to navigate · Enter to open · Esc to close";
const DETAIL_HINT = "↑/↓ to navigate · Enter to select · Esc to go back";
const TOOLS_HINT = "↑/↓ to scroll · Esc to go back";

type DetailChoice = { label: string; action: McpManagerAction | "view-tools" };

export function openMcpManager(): McpManagerState {
  return { open: true, view: { kind: "list", selected: 0 }, tools: null };
}

export function mcpManagerKeyOf(press: Press): McpManagerKey | null {
  if (press.name === "up" || press.name === "down") {
    return press.name;
  }
  if (press.name === "return") {
    return "enter";
  }
  if (press.name === "escape") {
    return "back";
  }
  if (!press.ctrl && !press.meta && /^[1-9]$/.test(press.input)) {
    return Number(press.input);
  }
  return null;
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
  if (view.kind === "list") {
    const selected = clamp(view.selected, ordered.length);
    if (key === "back") {
      return { state: closedMcpManager, action: { kind: "close" } };
    }
    if (key === "up" || key === "down") {
      const next = clamp(selected + (key === "up" ? -1 : 1), ordered.length);
      return { state: { ...state, view: { kind: "list", selected: next } }, action: none };
    }
    const server = ordered[selected];
    if (key === "enter" && server !== undefined) {
      const detail: McpManagerView = { kind: "detail", name: server.name, project: server.project ?? null, selected: 0 };
      return { state: { ...state, view: detail }, action: none };
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
  const picked = key === "enter" ? choices[clamp(view.selected, choices.length)] : choices[key - 1];
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
  if (input.error !== null) {
    body = [{ text: "Manage MCP servers", bold: true }, { text: "" }, { text: input.error }];
  } else if (servers === null) {
    body = [{ text: "Manage MCP servers", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else if (state.view.kind === "list") {
    body = listLines(servers, state.view.selected, home);
  } else {
    const view = state.view;
    const server = servers.find((item) => item.name === view.name && (item.project ?? null) === view.project);
    if (server === undefined) {
      body = listLines(servers, 0, home);
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

function listLines(servers: readonly McpServer[], selected: number, home: string): McpManagerLine[] {
  const lines: McpManagerLine[] = [
    { text: "Manage MCP servers", bold: true },
    { text: `${servers.length} ${servers.length === 1 ? "server" : "servers"}`, dim: true },
  ];
  if (servers.length === 0) {
    return [...lines, { text: "" }, { text: MCP_HINT }];
  }
  const nameWidth = Math.max(...servers.map((server) => server.name.length));
  const chosen = clamp(selected, servers.length);
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
