import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpCatalogEntry, McpServer } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  closedMcpManager,
  detailChoices,
  layoutMcpManager,
  mcpAdded,
  mcpAddFailed,
  mcpCatalogLoaded,
  type McpManagerAction,
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
  const state = { ...openMcpManager("/Users/me/app"), catalog: CATALOG };
  const lines = shown(state, []);
  assert.deepEqual(lines.slice(0, 8), [
    "Manage MCP servers",
    "0 servers",
    "",
    "Add one:",
    "❯ 1. Filesystem",
    "     Read and write files in a folder.",
    "  2. Fetch",
    "     Read web pages as text.",
  ]);
  assert.ok(!lines.join("\n").includes("config.toml"));
  assert.ok(shown(openMcpManager(), []).includes("loading the catalog…"));
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

const CATALOG: McpCatalogEntry[] = [
  {
    id: "filesystem",
    name: "filesystem",
    title: "Filesystem",
    description: "Read and write files in a folder.",
    category: "files",
    homepage: "https://example.com",
    runtime: "npx",
    auth: "none",
    inputs: [{ id: "folder", kind: "path", label: "Folder", default: "{folder}", required: true }],
  },
  {
    id: "fetch",
    name: "fetch",
    title: "Fetch",
    description: "Read web pages as text.",
    category: "web",
    homepage: "https://example.com",
    runtime: "uvx",
    auth: "none",
  },
  {
    id: "github",
    name: "github",
    title: "GitHub",
    description: "Repos, issues, and pull requests.",
    category: "code",
    homepage: "https://example.com",
    runtime: "url",
    auth: "token",
    inputs: [{ id: "token", kind: "secret", label: "GitHub token", hint: "Make a token at github.com/settings.", required: true }],
  },
  {
    id: "linear",
    name: "linear",
    title: "Linear",
    description: "Issues.",
    category: "productivity",
    homepage: "https://example.com",
    runtime: "url",
    auth: "oauth",
    available: false,
    reason: "needs sign-in",
  },
  {
    id: "notes",
    name: "notes",
    title: "Notes",
    description: "Notes.",
    category: "other",
    homepage: "https://example.com",
    runtime: "npx",
    auth: "none",
    added: true,
  },
];

/** The add screen with the daemon's catalog loaded, as `/mcp add` shows it. */
function loaded(id: string | null = null, folder = "/f"): { state: McpManagerState; action: McpManagerAction } {
  return mcpCatalogLoaded(openMcpAdd(folder, id), CATALOG);
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
  assert.equal(mcpManagerTyping(loaded("github").state), true);
});

test("the catalog loads first: the add screen says so, and keys wait", () => {
  const waiting = openMcpAdd("/f", null);
  assert.ok(shown(waiting).includes("loading the catalog…"));
  assert.equal(press(waiting, "enter").state, waiting);
  assert.equal(press(waiting, 1).action.kind, "none");
});

test("the add screen lists the catalog, then Other, and picks by Enter or number", () => {
  const { state, action } = loaded();
  assert.equal(action.kind, "none");
  assert.deepEqual(shown(state).slice(0, 6), [
    "Add an MCP server",
    "",
    "❯ 1. Filesystem",
    "     Read and write files in a folder.",
    "  2. Fetch",
    "     Read web pages as text.",
  ]);
  const text = shown(state).join("\n");
  assert.ok(text.includes("4. Linear"));
  assert.ok(text.includes("Issues. needs sign-in"));
  assert.ok(text.includes("Notes. Already added."));
  assert.ok(text.includes("6. Other"));
  assert.deepEqual(press(state, 2).action, {
    kind: "add",
    params: { name: "fetch", catalog_id: "fetch", inputs: {}, secrets: {} },
  });
  assert.equal(press(state, "down", "down", "enter").state.view.kind, "form");
  assert.equal(press(state, 6).state.view.kind, "other");
  assert.equal(press(state, 9).state, state);
  assert.deepEqual(press(state, "back").state.view, { kind: "list", selected: 0 });
});

test("an entry that can't be added says why, and stays on the catalog", () => {
  const { state } = loaded();
  assert.deepEqual(press(state, 4).state.view, { kind: "add", selected: 3, error: "needs sign-in" });
  assert.equal(press(state, 4).action.kind, "none");
  const added = press(state, 5);
  assert.equal(added.action.kind, "none");
  assert.ok(shown(added.state).some((line) => line.startsWith("✘ notes is already added")));
});

test("filesystem asks for the folder, starting at the session's", () => {
  const { state } = loaded("filesystem", "/Users/me/app");
  assert.deepEqual(state.view, { kind: "form", id: "filesystem", index: 0, values: { folder: "/Users/me/app" }, error: null });
  assert.ok(shown(state).includes("Folder: /Users/me/app"));
  const sent = press(state, "enter");
  assert.deepEqual(sent.action, {
    kind: "add",
    params: { name: "filesystem", catalog_id: "filesystem", inputs: { folder: "/Users/me/app" }, secrets: {} },
  });
  const edited = press(state, "clear", typed("/other"), "enter");
  assert.deepEqual(edited.action, {
    kind: "add",
    params: { name: "filesystem", catalog_id: "filesystem", inputs: { folder: "/other" }, secrets: {} },
  });
  const empty = press(state, "clear", "enter");
  assert.equal(empty.action.kind, "none");
  assert.ok(shown(empty.state).some((line) => line.startsWith("✘ Folder is needed")));
});

test("/mcp add github goes to the token, which is masked and sent on Enter", () => {
  const { state } = loaded("github");
  assert.deepEqual(state.view, { kind: "form", id: "github", index: 0, values: { token: "" }, error: null });
  assert.equal(press(state, "enter").action.kind, "none");
  assert.equal(press(state, typed("  "), "enter").action.kind, "none");
  const typedIn = press(state, typed("ghp_zzz"), typed("12"));
  const lines = shown(typedIn.state);
  assert.ok(lines.includes("GitHub token: •••••••••"));
  assert.ok(!lines.join("\n").includes("zzz"));
  assert.ok(lines.join("\n").includes("github.com/settings"));
  assert.ok(lines.includes("Stored in your Keychain, never in a file."));
  const sent = press(typedIn.state, "enter");
  assert.deepEqual(sent.action, {
    kind: "add",
    params: { name: "github", catalog_id: "github", inputs: {}, secrets: { token: "ghp_zzz12" } },
  });
  assert.equal(sent.state.view.kind, "adding");
  assert.ok(!JSON.stringify(sent.state).includes("zzz"));
  assert.deepEqual(shown(sent.state), ["Add an MCP server", "", "adding github…", "", "Esc is off until the server answers"]);
});

test("a form with two inputs goes through them in order, and Esc goes back one", () => {
  const two: McpCatalogEntry = {
    ...CATALOG[0]!,
    id: "two",
    name: "two",
    inputs: [
      { id: "a", kind: "text", label: "First", required: true },
      { id: "b", kind: "secret", label: "Second", required: true },
    ],
  };
  const { state } = mcpCatalogLoaded(openMcpAdd("/f", "two"), [two]);
  const second = press(state, typed("one"), "enter");
  assert.equal(second.state.view.kind === "form" && second.state.view.index, 1);
  assert.ok(shown(second.state)[0]?.includes("2 of 2"));
  const back = press(second.state, "back").state.view;
  assert.equal(back.kind === "form" && back.index, 0);
  const sent = press(second.state, typed("s3"), "enter");
  assert.deepEqual(sent.action, {
    kind: "add",
    params: { name: "two", catalog_id: "two", inputs: { a: "one" }, secrets: { b: "s3" } },
  });
});

test("the form edits: delete, clear, and Esc back to the catalog", () => {
  const { state } = loaded("github");
  const value = (s: McpManagerState) => (s.view.kind === "form" ? s.view.values["token"] : null);
  assert.equal(value(press(state, typed("abc"), "delete").state), "ab");
  assert.equal(value(press(state, typed("abc"), "clear").state), "");
  assert.deepEqual(press(state, typed("abc"), "back").state.view, { kind: "add", selected: 2, error: null });
});

test("a failed add returns to the screen it came from with the daemon's message, and asks again", () => {
  const sent = press(loaded("github").state, typed("ghp_zzz"), "enter").state;
  const failed = mcpAddFailed(sent, "an MCP server named github already exists");
  assert.deepEqual(failed.view, {
    kind: "form",
    id: "github",
    index: 0,
    values: {},
    error: "an MCP server named github already exists",
  });
  assert.ok(shown(failed).includes("✘ an MCP server named github already exists"));
  assert.ok(!JSON.stringify(failed).includes("zzz"));
  const again = press(failed, typed("x")).state.view;
  assert.equal(again.kind === "form" && again.values["token"], "x");
  const fetching = mcpAddFailed(loaded("fetch").state, "boom");
  assert.deepEqual(fetching.view, { kind: "add", selected: 1, error: "boom" });
  assert.equal(mcpAddFailed(openMcpManager(), "x").view.kind, "list");
});

test("an id the catalog lacks says so", () => {
  const { state, action } = loaded("nope");
  assert.equal(action.kind, "none");
  assert.deepEqual(state.view, { kind: "add", selected: 0, error: "nope is not in the catalog." });
});

test("while adding, keys do nothing", () => {
  const adding = loaded("fetch").state;
  assert.equal(adding.view.kind, "adding");
  for (const key of ["up", "down", "enter", "back", "add", 1] as const) {
    assert.equal(press(adding, key).state, adding);
    assert.equal(press(adding, key).action.kind, "none");
  }
});

test("other asks for a name, then a command or a URL, and says what is wrong", () => {
  const start = loaded("other").state;
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
  assert.deepEqual(press(start, "back").state.view, { kind: "add", selected: 5, error: null });
});

test("an added server shows in the list, selected", () => {
  const added: McpServer = { ...git, name: "fetch" };
  const servers = [...SERVERS, added];
  const sent = loaded("fetch").state;
  const state = mcpAdded(sent, servers, "fetch");
  assert.deepEqual(state.view, { kind: "list", selected: 3 });
  assert.ok(shown(state, servers).some((line) => line.startsWith("❯ ✔ fetch")));
});
