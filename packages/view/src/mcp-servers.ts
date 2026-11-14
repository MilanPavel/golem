import type { McpLoginDone, McpServer } from "@golem/client";

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

/** For the status line: the servers this session uses that are down or need a sign-in, or "". */
export function mcpAlert(servers: readonly McpServer[] | null): string {
  const used = (servers ?? []).filter((server) => server.enabled === true);
  const down = used.filter((server) => server.state === "failed");
  const signIn = used.filter((server) => server.state === "needs_auth");
  const parts = [
    ...(down.length === 0 ? [] : [`mcp ✗ ${down.map((server) => server.name).join(", ")}`]),
    ...(signIn.length === 0 ? [] : [`mcp ! sign in: ${signIn.map((server) => server.name).join(", ")}`]),
  ];
  return parts.join(" · ");
}

/** What the row and the detail say about a server that waits for a sign-in. */
export const SIGN_IN_NEEDED = "Sign in needed";

/** The sign-in of a server ended: `Signed in to Linear · 12 tools`, or why it did not work. */
export function loginDoneText(done: McpLoginDone, tools: number | null): string {
  if (!done.ok) {
    return done.error ?? `Could not sign in to ${done.name}`;
  }
  const count = tools === null ? "" : ` · ${tools} ${tools === 1 ? "tool" : "tools"}`;
  return `Signed in to ${done.name}${count}`;
}

/**
 * Whether `server` signs in with OAuth as far as the list can tell: it waits for a sign-in, or it is the
 * catalog entry of that name that was added. (`mcp.logout` works on any hosted server, so Sign out is
 * offered only where it means something.)
 */
export function signsIn(server: McpServer, catalog: readonly { name: string; auth: string; added?: boolean | null }[] | null): boolean {
  if (server.state === "needs_auth") {
    return true;
  }
  return (catalog ?? []).some((entry) => entry.auth === "oauth" && entry.added === true && entry.name === server.name && !server.project);
}

/** What a person can do with a server that needs no screen of its own. */
export type McpDetailAction =
  | { kind: "session"; name: string; on: boolean }
  | { kind: "restart"; name: string }
  | { kind: "login"; name: string }
  | { kind: "logout"; name: string }
  | { kind: "set-enabled"; name: string; enabled: boolean | "on_demand" };

/** A choice on a server's detail: the action to run, or the screen to open. */
export type DetailChoice = { label: string; action: McpDetailAction | "view-tools" | "view-logs" | "ask-remove" | "run-test" };

/** The user's servers first, then the project's, each sorted by name, as the list shows them. */
export function orderedServers(servers: readonly McpServer[]): McpServer[] {
  const mine = servers.filter((server) => !server.project);
  const project = servers.filter((server) => server.project);
  return [...mine, ...project];
}

/** The menu word for the opt-in mode: the server loads only in the chats that ask for it. */
export const ONLY_WHEN_ASKED = "Only when a chat asks (saves tokens)";

/** What can be done with `server`, in the order the screen numbers it. */
export function detailChoices(server: McpServer, oauth = server.state === "needs_auth"): DetailChoice[] {
  const name = server.name;
  const choices: DetailChoice[] = [];
  if (server.state === "needs_auth") {
    choices.push({ label: "Sign in", action: { kind: "login", name } });
  }
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
    choices.push({ label: ONLY_WHEN_ASKED, action: { kind: "set-enabled", name, enabled: "on_demand" } });
    return [...choices, ...inspect, ...remove];
  }
  if (server.on_demand) {
    const on = server.enabled === true;
    choices.push({
      label: on ? "Turn off for this chat" : "Turn on for this chat",
      action: { kind: "session", name, on: !on },
    });
  }
  // `mcp.restart` starts a server that has not started yet, so an idle one gets Start.
  choices.push({ label: server.state === "idle" ? "Start" : "Reconnect", action: { kind: "restart", name } });
  // The mode it is not in already.
  if (oauth && server.state !== "needs_auth") {
    choices.push({ label: "Sign out", action: { kind: "logout", name } });
  }
  choices.push(
    server.on_demand
      ? { label: "Enable for every chat", action: { kind: "set-enabled", name, enabled: true } }
      : { label: ONLY_WHEN_ASKED, action: { kind: "set-enabled", name, enabled: "on_demand" } },
  );
  choices.push({ label: "Disable everywhere", action: { kind: "set-enabled", name, enabled: false } });
  return [...choices, ...inspect, ...remove];
}

/**
 * One row of the list: tools and tokens, or the error and when it retries, or how it is turned on.
 * Without a chat (`session` false) there is nothing to be on or off in, so that is not said.
 */
export function mcpSummary(server: McpServer, session = true): string {
  if (server.state === "running") {
    const count = server.tools?.length ?? 0;
    const tokens = server.schema_tokens == null ? "" : ` · ${formatTokens(server.schema_tokens)} tokens`;
    return `${count} ${count === 1 ? "tool" : "tools"}${tokens}${markNote(server)}${hereNote(server, session)}`;
  }
  if (server.state === "failed") {
    const retry = server.retry_seconds == null ? "" : ` · retry in ${formatSeconds(server.retry_seconds)}`;
    return `${server.error ?? "failed"}${retry}`;
  }
  if (server.state === "idle") {
    return `on demand${hereNote(server, session)}`;
  }
  if (server.state === "disabled") {
    return "disabled";
  }
  if (server.state === "needs_auth") {
    return SIGN_IN_NEEDED;
  }
  return "starting…";
}

/** What limits the server: tools kept from the model, and calls that run without asking. */
function markNote(server: McpServer): string {
  const count = server.tools_hidden ?? 0;
  const hidden = count > 0 ? ` · ${count} hidden` : "";
  const approval = server.approval === "allow" ? " · allow" : server.approval === "read-only" ? " · read-only" : "";
  return `${hidden}${approval}`;
}

function hereNote(server: McpServer, session: boolean): string {
  if (!server.on_demand) {
    return " · on in every chat";
  }
  if (!session) {
    return "";
  }
  return server.enabled === true ? " · on in this chat" : " · off in this chat";
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
  if (server.state === "needs_auth") {
    return { text: "!", tone: "wait" };
  }
  return { text: server.state === "idle" ? "○" : "–", tone: "off" };
}

export function mcpStatusWord(server: McpServer): string {
  if (server.state === "idle") {
    return "on demand";
  }
  if (server.state === "needs_auth") {
    return "needs sign-in";
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
