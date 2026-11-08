import type { McpServer } from "@golem/client";

import { formatTokens } from "./context.ts";

export type McpTone = "ok" | "bad" | "wait" | "off";

/** The session's MCP servers once `mcp.list` answers, or why it did not. `/mcp` and the status line read it. */
export type McpList = { servers: readonly McpServer[] | null; error: string | null };

/** What the list says when there is no server yet. */
export const MCP_HINT = "Add one with golem mcp add --catalog <id>, or write [mcp.<name>] with a command or a url in ~/.golem/config.toml.";

/**
 * `servers` with `changed` in place of the server it reports on. A status
 * from the broadcast does not say whether this session has the server on, so
 * that is kept, and a server this session does not list is left out.
 */
export function mergeMcp(servers: readonly McpServer[], changed: McpServer): McpServer[] {
  return servers.map((server) =>
    server.name === changed.name && (server.project ?? null) === (changed.project ?? null)
      ? { ...changed, enabled: server.enabled }
      : server,
  );
}

/** For the status line: the servers this session uses that are down, or "". */
export function mcpAlert(servers: readonly McpServer[] | null): string {
  const down = (servers ?? []).filter((server) => server.enabled === true && server.state === "failed");
  return down.length === 0 ? "" : `mcp ✗ ${down.map((server) => server.name).join(", ")}`;
}

/** What a person can do with a server that needs no screen of its own. */
export type McpDetailAction =
  | { kind: "session"; name: string; on: boolean }
  | { kind: "restart"; name: string }
  | { kind: "set-enabled"; name: string; enabled: boolean | "on_demand" };

/** A choice on a server's detail: the action to run, or the screen to open. */
export type DetailChoice = { label: string; action: McpDetailAction | "view-tools" | "view-logs" | "ask-remove" | "run-test" };

/** The user's servers first, then the project's, each sorted by name, as the list shows them. */
export function orderedServers(servers: readonly McpServer[]): McpServer[] {
  const mine = servers.filter((server) => !server.project);
  const project = servers.filter((server) => server.project);
  return [...mine, ...project];
}

/** What can be done with `server`, in the order the screen numbers it. */
export function detailChoices(server: McpServer): DetailChoice[] {
  const name = server.name;
  const choices: DetailChoice[] = [];
  if (server.state === "running" && (server.tools?.length ?? 0) > 0) {
    choices.push({ label: "View tools", action: "view-tools" });
  }
  const inspect: DetailChoice[] = [
    { label: "Test the connection", action: "run-test" },
    { label: "View the log", action: "view-logs" },
  ];
  // A project's server lives in that project's file: it is changed there, not removed from here.
  const remove: DetailChoice[] = server.project ? [] : [{ label: "Remove", action: "ask-remove" }];
  if (server.state === "disabled") {
    choices.push({ label: "Enable for every chat", action: { kind: "set-enabled", name, enabled: true } });
    choices.push({ label: "Enable on demand", action: { kind: "set-enabled", name, enabled: "on_demand" } });
    return [...choices, ...inspect, ...remove];
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
  return [...choices, ...inspect, ...remove];
}

/** One row of the list: tools and tokens, or the error and when it retries, or how it is turned on. */
export function mcpSummary(server: McpServer): string {
  if (server.state === "running") {
    const count = server.tools?.length ?? 0;
    const tokens = server.schema_tokens == null ? "" : ` · ≈${formatTokens(server.schema_tokens)} tokens`;
    return `${count} ${count === 1 ? "tool" : "tools"}${tokens}${markNote(server)}${hereNote(server)}`;
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

/** What limits the server: tools kept from the model, and calls that run without asking. */
function markNote(server: McpServer): string {
  const count = server.tools_hidden ?? 0;
  const hidden = count > 0 ? ` · ${count} hidden` : "";
  return `${hidden}${server.approval === "allow" ? " · allow" : ""}`;
}

function hereNote(server: McpServer): string {
  if (!server.on_demand) {
    return "";
  }
  return server.enabled === true ? " · on here" : " · off here";
}

/** The glyph and tone of a server's state. The word goes with it, so colour is never alone. */
export function mcpStatusMark(server: McpServer): { text: string; tone: McpTone } {
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

export function mcpStatusWord(server: McpServer): string {
  if (server.state === "idle") {
    return "idle (on demand)";
  }
  return server.state;
}

export function shortPath(path: string, home: string): string {
  return home.length > 0 && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

export function formatSeconds(seconds: number): string {
  return seconds < 1 ? "<1s" : `${Math.round(seconds)}s`;
}
