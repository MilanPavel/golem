import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  closedMcpManager,
  detailChoices,
  layoutMcpManager,
  MCP_HINT,
  mcpManagerKeyOf,
  type McpManagerState,
  openMcpManager,
  orderedServers,
  pressMcpManager,
} from "./mcp-manager.ts";

const HOME = "/Users/me";
const git: McpServer = {
  name: "git",
  state: "running",
  command: "mcp-server-git --repository /Users/me/repo",
  tools: ["mcp__git__git_status", "mcp__git__git_log"],
  schema_tokens: 1320,
  enabled: true,
  config: "/Users/me/.golem/config.toml",
};
const github: McpServer = {
  name: "github",
  state: "failed",
  command: "https://api.example.com/mcp",
  error: "HTTP 401: bad token",
  retry_seconds: 4,
  enabled: true,
  config: "/Users/me/.golem/config.toml",
};
const lazy: McpServer = {
  name: "lazy",
  state: "idle",
  command: "npx lazy",
  on_demand: true,
  enabled: false,
  config: "/Users/me/.golem/config.toml",
};
const db: McpServer = {
  name: "db",
  state: "running",
  command: "db-mcp",
  tools: ["mcp__db__query"],
  project: "/Users/me/app",
  config: "/Users/me/app/.golem/config.toml",
  enabled: true,
};
const SERVERS = [db, git, github, lazy];

function press(state: McpManagerState, ...keys: Parameters<typeof pressMcpManager>[2][]) {
  let current = state;
  let action: ReturnType<typeof pressMcpManager>["action"] = { kind: "none" };
  for (const key of keys) {
    ({ state: current, action } = pressMcpManager(current, SERVERS, key));
  }
  return { state: current, action };
}

function shown(state: McpManagerState, servers: readonly McpServer[] | null = SERVERS, rows = 40): string[] {
  return layoutMcpManager({ state, servers, error: null, home: HOME, columns: 100, rows }).map(
    (line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`,
  );
}

test("keys: arrows, Enter, Esc, and a digit for a numbered choice", () => {
  const key = (name: Press["name"], input = "") => mcpManagerKeyOf({ name, input, ctrl: false, meta: false });
  assert.equal(key("up"), "up");
  assert.equal(key("return"), "enter");
  assert.equal(key("escape"), "back");
  assert.equal(key(null, "3"), 3);
  assert.equal(key(null, "x"), null);
});

test("the list groups the user's servers, then the project's", () => {
  assert.deepEqual(
    orderedServers(SERVERS).map((server) => server.name),
    ["git", "github", "lazy", "db"],
  );
  assert.deepEqual(shown(openMcpManager()), [
    "Manage MCP servers",
    "4 servers",
    "",
    "  Yours (~/.golem/config.toml)",
    "❯ ✔ git     2 tools · ≈1.3k tokens",
    "  ✘ github  HTTP 401: bad token · retrying in 4s",
    "  ○ lazy    on demand · off here",
    "",
    "  This project (~/app/.golem/config.toml)",
    "  ✔ db      1 tool",
    "",
    "↑/↓ to navigate · Enter to open · Esc to close",
  ]);
});

test("no servers says how to add one, and the wait says so", () => {
  assert.deepEqual(shown(openMcpManager(), []).slice(0, 4), ["Manage MCP servers", "0 servers", "", MCP_HINT]);
  assert.equal(shown(openMcpManager(), null)[2], "asking the daemon…");
});

test("Enter opens a server, its details, and what can be done with it", () => {
  const { state } = press(openMcpManager(), "enter");
  assert.deepEqual(state.view, { kind: "detail", name: "git", project: null, selected: 0 });
  assert.deepEqual(shown(state), [
    "git MCP server",
    "",
    "Status:        ✔ running",
    "Command:       mcp-server-git --repository /Users/me/repo",
    "Config:        ~/.golem/config.toml",
    "Tools:         2 tools · ≈1.3k tokens per prompt",
    "In this chat:  on · every chat",
    "",
    "❯ 1. View tools",
    "  2. Reconnect",
    "  3. Disable everywhere",
    "",
    "↑/↓ to navigate · Enter to select · Esc to go back",
  ]);
});

test("each kind of server offers what fits it", () => {
  const labels = (server: McpServer) => detailChoices(server).map((choice) => choice.label);
  assert.deepEqual(labels(github), ["Reconnect", "Disable everywhere"]);
  assert.deepEqual(labels(lazy), ["Turn on for this chat", "Disable everywhere"]);
  assert.deepEqual(labels({ ...lazy, state: "running", tools: ["x"], enabled: true }), [
    "View tools",
    "Turn off for this chat",
    "Reconnect",
    "Disable everywhere",
  ]);
  assert.deepEqual(labels({ ...git, state: "disabled", tools: [], enabled: false }), [
    "Enable for every chat",
    "Enable on demand",
  ]);
});

test("choosing an action asks the app to do it, by Enter or by number", () => {
  const detail = press(openMcpManager(), "enter").state;
  assert.deepEqual(press(detail, "down", "enter").action, { kind: "restart", name: "git" });
  assert.deepEqual(press(detail, 3).action, { kind: "set-enabled", name: "git", enabled: false });
  assert.deepEqual(press(detail, 9).action, { kind: "none" });
  const onLazy = press(openMcpManager(), "down", "down", "enter", 1).action;
  assert.deepEqual(onLazy, { kind: "session", name: "lazy", on: true });
});

test("View tools loads them, lists them without the prefix, and Esc goes back one screen at a time", () => {
  const detail = press(openMcpManager(), "enter").state;
  const opened = press(detail, "enter");
  assert.deepEqual(opened.action, { kind: "load-tools", name: "git" });
  assert.equal(shown(opened.state)[2], "loading…");
  const loaded: McpManagerState = {
    ...opened.state,
    tools: {
      name: "git",
      tools: [
        { name: "mcp__git__git_status", description: "Shows the working tree status.\nMore." },
        { name: "mcp__git__git_log", description: "Shows the commit log." },
      ],
    },
  };
  assert.deepEqual(shown(loaded).slice(0, 4), [
    "git tools",
    "",
    "git_status  Shows the working tree status.",
    "git_log     Shows the commit log.",
  ]);
  const back = press(loaded, "back").state;
  assert.equal(back.view.kind, "detail");
  const list = press(back, "back").state;
  assert.deepEqual(list.view, { kind: "list", selected: 0 });
  assert.deepEqual(press(list, "back"), { state: closedMcpManager, action: { kind: "close" } });
});

test("a server that goes away while open returns to the list", () => {
  const detail = press(openMcpManager(), "down", "enter").state;
  const { state } = pressMcpManager(detail, [git], "down");
  assert.deepEqual(state.view, { kind: "list", selected: 0 });
});

test("a long list scrolls to keep the selection on screen", () => {
  const many: McpServer[] = Array.from({ length: 20 }, (_, index) => ({
    ...git,
    name: `s${String(index).padStart(2, "0")}`,
  }));
  let state = openMcpManager();
  for (let step = 0; step < 15; step += 1) {
    state = pressMcpManager(state, many, "down").state;
  }
  const lines = layoutMcpManager({ state, servers: many, error: null, home: HOME, columns: 80, rows: 10 });
  assert.equal(lines.length, 10);
  assert.ok(lines.some((line) => line.selected === true && line.text.startsWith("s15")));
});
