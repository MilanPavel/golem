import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServer } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  closedMcpManager,
  detailChoices,
  layoutMcpManager,
  mcpAdded,
  mcpAddFailed,
  mcpManagerTyping,
  mcpManagerKeyOf,
  type McpManagerState,
  openMcpAdd,
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
    "  + Add a server",
    "",
    "↑/↓ to navigate · Enter to open · a to add a server · Esc to close",
  ]);
});

test("no servers shows the catalog, and the wait says so", () => {
  const lines = shown(openMcpManager("/Users/me/app"), []);
  assert.deepEqual(lines.slice(0, 8), [
    "Manage MCP servers",
    "0 servers",
    "",
    "Add one:",
    "❯ 1. Filesystem: /Users/me/app",
    "     Read and write files in the session folder.",
    "  2. GitHub",
    "     Repos, issues, and pull requests. Asks for a token.",
  ]);
  assert.ok(!lines.join("\n").includes("config.toml"));
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

const typed = (text: string) => ({ text });
const NONE = { kind: "none" } as const;

function pressNone(state: McpManagerState, servers: readonly McpServer[], ...keys: Parameters<typeof pressMcpManager>[2][]) {
  let current = state;
  let action: ReturnType<typeof pressMcpManager>["action"] = NONE;
  for (const key of keys) {
    ({ state: current, action } = pressMcpManager(current, servers, key));
  }
  return { state: current, action };
}

test("a is Add a server, the last row of the list, and it opens the catalog", () => {
  const byKey = press(openMcpManager("/f"), "add");
  assert.deepEqual(byKey.state.view, { kind: "add", selected: 0, error: null });
  const byRow = press(openMcpManager("/f"), "down", "down", "down", "down", "down", "enter");
  assert.deepEqual(byRow.state.view, { kind: "add", selected: 0, error: null });
  assert.deepEqual(press(byKey.state, "back").state.view, { kind: "list", selected: 0 });
  assert.equal(press(openMcpManager(), "down", "down", "down", "down", "down", "down").state.view.kind, "list");
});

test("keys: a is add on a list, and text on a prompt", () => {
  const key = (name: Press["name"], input = "", typing = false) =>
    mcpManagerKeyOf({ name, input, ctrl: false, meta: false }, typing);
  assert.equal(key(null, "a"), "add");
  assert.deepEqual(key(null, "a", true), { text: "a" });
  assert.deepEqual(key(null, "7", true), { text: "7" });
  assert.deepEqual(key(null, "ab\n", true), { text: "ab" });
  assert.equal(key("backspace", "", true), "delete");
  assert.equal(key("ctrl-u", "", true), "clear");
  assert.equal(key("up", "", true), null);
  assert.equal(key("escape", "", true), "back");
  assert.equal(mcpManagerKeyOf({ name: null, input: "x", ctrl: true, meta: false }, true), null);
  assert.equal(mcpManagerTyping(openMcpManager()), false);
  assert.equal(mcpManagerTyping(openMcpAdd("/f", "github").state), true);
});

test("the empty list takes a number or Enter to pick, and Esc closes", () => {
  const first = pressNone(openMcpManager("/Users/me/app"), [], 1);
  assert.deepEqual(first.action, {
    kind: "add",
    params: { name: "filesystem", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/app"] },
  });
  assert.deepEqual(first.state.view, {
    kind: "adding",
    name: "filesystem",
    back: { kind: "add", selected: 0, error: null },
  });
  assert.deepEqual(pressNone(openMcpManager("/f"), [], "down", "down", "enter").action, {
    kind: "add",
    params: { name: "fetch", command: "uvx", args: ["mcp-server-fetch"] },
  });
  assert.deepEqual(pressNone(openMcpManager(), [], "back").action, { kind: "close" });
});

test("the add view picks by Enter or number, and Esc goes back", () => {
  const view = openMcpAdd("/f", null);
  assert.deepEqual(view.state.view, { kind: "add", selected: 0, error: null });
  assert.equal(view.action.kind, "none");
  assert.deepEqual(press(view.state, 3).action, { kind: "add", params: { name: "fetch", command: "uvx", args: ["mcp-server-fetch"] } });
  assert.deepEqual(press(view.state, "down", "enter").state.view, { kind: "token", id: "github", value: "", error: null });
  assert.equal(press(view.state, 4).state.view.kind, "other");
  assert.equal(press(view.state, 9).state, view.state);
  assert.deepEqual(shown(view.state, SERVERS).slice(0, 4), [
    "Add an MCP server",
    "",
    "❯ 1. Filesystem: /f",
    "     Read and write files in the session folder.",
  ]);
});

test("/mcp add github goes to the token, which is masked and sent on Enter", () => {
  const { state } = openMcpAdd("/f", "github");
  assert.deepEqual(state.view, { kind: "token", id: "github", value: "", error: null });
  assert.equal(press(state, "enter").action.kind, "none");
  assert.equal(press(state, typed("  "), "enter").action.kind, "none");
  const typedIn = press(state, typed("ghp_secret"), typed("12"));
  const lines = shown(typedIn.state);
  assert.ok(lines.includes("Token: ••••••••••••"));
  assert.ok(!lines.join("\n").includes("secret"));
  assert.ok(lines.join("\n").includes("github.com/settings/personal-access-tokens/new"));
  assert.ok(lines.join("\n").includes("Pull requests."));
  const sent = press(typedIn.state, "enter");
  assert.deepEqual(sent.action, {
    kind: "add",
    params: { name: "github", url: "https://api.githubcopilot.com/mcp/", token: "ghp_secret12" },
  });
  assert.equal(sent.state.view.kind, "adding");
  assert.ok(!JSON.stringify(sent.state).includes("secret"));
  assert.deepEqual(shown(sent.state), ["Add an MCP server", "", "adding github…", "", "Esc is off until the server answers"]);
});

test("the token prompt edits: delete, clear, and Esc back to the catalog", () => {
  const { state } = openMcpAdd("/f", "github");
  const view = (s: McpManagerState) => (s.view.kind === "token" ? s.view.value : null);
  assert.equal(view(press(state, typed("abc"), "delete").state), "ab");
  assert.equal(view(press(state, typed("abc"), "clear").state), "");
  assert.deepEqual(press(state, typed("abc"), "back").state.view, { kind: "add", selected: 1, error: null });
});

test("a failed add returns to the screen it came from with the daemon's message, and asks again", () => {
  const sent = press(openMcpAdd("/f", "github").state, typed("tok"), "enter").state;
  const failed = mcpAddFailed(sent, "an MCP server named github already exists");
  assert.deepEqual(failed.view, { kind: "token", id: "github", value: "", error: "an MCP server named github already exists" });
  assert.ok(shown(failed).includes("✘ an MCP server named github already exists"));
  assert.deepEqual(press(failed, typed("x")).state.view, { kind: "token", id: "github", value: "x", error: null });
  const fetching = mcpAddFailed(openMcpAdd("/f", "fetch").state, "boom");
  assert.deepEqual(fetching.view, { kind: "add", selected: 2, error: "boom" });
  assert.equal(mcpAddFailed(openMcpManager(), "x").view.kind, "list");
});

test("while adding, keys do nothing", () => {
  const adding = openMcpAdd("/f", "fetch").state;
  for (const key of ["up", "down", "enter", "back", "add", 1] as const) {
    assert.equal(press(adding, key).state, adding);
    assert.equal(press(adding, key).action.kind, "none");
  }
});

test("other asks for a name, then a command or a URL, and says what is wrong", () => {
  const start = openMcpAdd("/f", "other").state;
  assert.deepEqual(start.view, { kind: "other", field: "name", name: "", command: "", error: null });
  const bad = press(start, typed("my server"), "enter").state;
  assert.equal(bad.view.kind === "other" && bad.view.field, "name");
  assert.ok(shown(bad).some((line) => line.startsWith("✘ Use letters")));
  assert.ok(shown(press(start, "enter").state).some((line) => line.startsWith("✘ Give the server a name")));
  const second = press(start, typed("my-tool"), "enter").state;
  assert.equal(second.view.kind === "other" && second.view.field, "command");
  assert.ok(shown(second).includes("❯ Command: "));
  const empty = press(second, "enter");
  assert.equal(empty.action.kind, "none");
  assert.ok(shown(empty.state).some((line) => line.startsWith("✘ Type a command")));
  const run = press(second, typed("uvx tool 'a b'"), "enter");
  assert.deepEqual(run.action, { kind: "add", params: { name: "my-tool", command: "uvx", args: ["tool", "a b"] } });
  const url = press(second, typed("https://x.example/mcp"), "enter");
  assert.deepEqual(url.action, { kind: "add", params: { name: "my-tool", url: "https://x.example/mcp" } });
  assert.deepEqual(press(second, "back").state.view, {
    kind: "other",
    field: "name",
    name: "my-tool",
    command: "",
    error: null,
  });
  assert.deepEqual(press(start, "back").state.view, { kind: "add", selected: 3, error: null });
});

test("an added server shows in the list, selected", () => {
  const added: McpServer = { ...git, name: "fetch" };
  const servers = [...SERVERS, added];
  const sent = pressNone(openMcpAdd("/f", "fetch").state, servers).state;
  const state = mcpAdded(sent, servers, "fetch");
  assert.deepEqual(state.view, { kind: "list", selected: 3 });
  assert.ok(shown(state, servers).some((line) => line.startsWith("❯ ✔ fetch")));
});
