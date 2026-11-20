import assert from "node:assert/strict";
import { test } from "node:test";

import { RpcError, type AgentInfo } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  agentCounts,
  agentListFailed,
  agentsWithSaved,
  agentWishFailed,
  WISH_OLD,
  agentsManagerKeyOf,
  AGENTS_HINT,
  closedAgentsManager,
  layoutAgentsManager,
  NO_AGENTS,
  openAgentsManager,
  pressAgentsManager,
  type AgentsManagerKey,
  type AgentsManagerState,
} from "./agents-manager.ts";
import type { WishSetup } from "@golem/view";

const HOME = "/Users/me";
const CWD = "/Users/me/repo";
const scout: AgentInfo = {
  name: "scout",
  description: "Looks through the code and reports what it finds.",
  origin: "bundled",
  wish: "cheapest",
  tools: ["read_file", "grep"],
  limits: { max_seconds: 300, max_calls: 40 },
  used: 41,
  finished: 39,
};
const reviewer: AgentInfo = {
  name: "reviewer",
  description: "Reads a diff.",
  origin: "user",
  wish: "stronger",
  tools: ["read_file"],
  used: 0,
  finished: null,
  shadowed: ["bundled"],
};
const mine: AgentInfo = {
  name: "triage",
  description: "Sorts the issues.",
  origin: "project",
  wish: "same",
  asks: true,
  used: 2,
  finished: 2,
};
const untrusted: AgentInfo = { ...mine, name: "deploy", description: "Ships.", trusted: false, used: 0, finished: null };
const broken: AgentInfo = {
  name: "broken",
  description: "",
  origin: "user",
  wish: "cheapest",
  errors: ["the header is not valid YAML: line 3"],
};
const ALL = [mine, untrusted, reviewer, broken, scout];

const press = (name: Press["name"], input = ""): Press => ({ name, input, ctrl: false, meta: false });

function layout(state: AgentsManagerState, agents: readonly AgentInfo[] | null, error: string | null = null, rows = 40, setup?: WishSetup) {
  return layoutAgentsManager({ state, agents, error, cwd: CWD, home: HOME, columns: 140, rows, setup });
}

function texts(lines: ReturnType<typeof layout>): string[] {
  return lines.map((line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`);
}

function press1(state: AgentsManagerState, key: AgentsManagerKey, agents: readonly AgentInfo[] = ALL) {
  return pressAgentsManager(state, agents, key).state;
}

test("keys: arrows, Enter, and Esc", () => {
  assert.equal(agentsManagerKeyOf(press("up")), "up");
  assert.equal(agentsManagerKeyOf(press("down")), "down");
  assert.equal(agentsManagerKeyOf(press("return")), "enter");
  assert.equal(agentsManagerKeyOf(press("escape")), "back");
  assert.equal(agentsManagerKeyOf(press(null, "x")), null);
});

test("no agents says where to put one, and the wait says so", () => {
  const empty = texts(layout(openAgentsManager(), []));
  assert.ok(empty.includes("0 agents · helpers, last 30 days"));
  assert.ok(empty.includes(AGENTS_HINT));
  assert.ok(texts(layout(openAgentsManager(), null)).includes("asking the daemon…"));
});

test("the list groups the project's agents, then yours, then bundled, with the counts", () => {
  const lines = texts(layout(openAgentsManager(), ALL));
  const at = (word: string) => lines.findIndex((line) => line.includes(word));
  assert.ok(at("This project (~/repo)") < at("Yours"));
  assert.ok(at("Yours") < at("Bundled with golem"));
  assert.ok(lines.some((line) => line.includes("scout") && line.includes("used 41 · finished 39") && line.includes("Looks through")));
  assert.ok(lines.some((line) => line.includes("reviewer") && line.includes("not used yet")));
  assert.ok(lines.some((line) => line.includes("triage") && line.includes("used 2 · finished 2")));
});

test("the counts: finished is a number of helpers, and none used says so", () => {
  assert.equal(agentCounts(scout), "used 41 · finished 39");
  assert.equal(agentCounts(reviewer), "not used yet");
  assert.equal(agentCounts({ ...scout, finished: null }), "used 41");
});

test("an untrusted project agent is marked and says why in the list and the detail", () => {
  const lines = texts(layout(openAgentsManager(), ALL));
  assert.ok(lines.some((line) => line.includes("! deploy") && line.includes("not trusted")));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "deploy", origin: "project" } }, ALL));
  assert.ok(detail.some((line) => line.includes("Status:") && line.includes("not trusted: never started")));
  assert.ok(detail.includes("Warnings"));
});

test("a broken agent shows its error in the list and the detail", () => {
  const lines = texts(layout(openAgentsManager(), ALL));
  assert.ok(lines.some((line) => line.includes("✘ broken") && line.includes("the header is not valid YAML: line 3")));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "broken", origin: "user" } }, ALL));
  assert.ok(detail.some((line) => line.includes("Status:") && line.includes("broken: never started")));
  assert.ok(detail.includes("Errors"));
  assert.ok(detail.some((line) => line.includes("the header is not valid YAML: line 3")));
});

test("Enter opens an agent: description, model, tools, limits and counts", () => {
  let state = openAgentsManager();
  // The order shown is project (deploy, triage), user (reviewer, broken), bundled (scout).
  for (let step = 0; step < 4; step += 1) {
    state = press1(state, "down");
  }
  state = press1(state, "enter");
  assert.deepEqual(state.view, { kind: "detail", name: "scout", origin: "bundled" });
  const lines = texts(layout(state, ALL));
  assert.equal(lines[0], "scout agent");
  assert.ok(lines.some((line) => line.startsWith("Description:") && line.includes("Looks through the code")));
  assert.ok(lines.some((line) => line.startsWith("Model:") && line.includes("Cheapest that fits")));
  assert.ok(lines.some((line) => line.startsWith("Tools:") && line.includes("read_file, grep")));
  assert.ok(lines.some((line) => line.startsWith("Limits:") && line.includes("300 s of work, 40 tool calls")));
  assert.ok(lines.some((line) => line.startsWith("Helpers:") && line.includes("used 41 · finished 39")));
  const mineLines = texts(layout({ open: true, view: { kind: "detail", name: "triage", origin: "project" } }, ALL));
  assert.ok(mineLines.some((line) => line.startsWith("May ask you:") && line.includes("yes")));
  const hidden = texts(layout({ open: true, view: { kind: "detail", name: "reviewer", origin: "user" } }, ALL));
  assert.ok(hidden.some((line) => line.startsWith("Hides:") && line.includes("Bundled with golem")));
  assert.ok(hidden.some((line) => line.startsWith("Limits:") && line.includes("none set")));
});

test("Esc goes back to the list on the same agent, then closes", () => {
  const opened = press1(press1(openAgentsManager(), "down"), "enter");
  assert.equal(opened.view.kind, "detail");
  const back = press1(opened, "back");
  assert.deepEqual(back.view, { kind: "list", selected: 1 });
  const closed = pressAgentsManager(back, ALL, "back");
  assert.deepEqual(closed.state, closedAgentsManager);
  assert.deepEqual(closed.action, { kind: "close" });
});

test("the selection stays in range, and a refreshed list keeps the open agent or falls back", () => {
  let state = openAgentsManager();
  state = press1(state, "up");
  assert.deepEqual(state.view, { kind: "list", selected: 0 });
  for (let step = 0; step < 20; step += 1) {
    state = press1(state, "down");
  }
  assert.deepEqual(state.view, { kind: "list", selected: ALL.length - 1 });
  // `agent.registry.changed` brings a new list: the same state draws it.
  const open: AgentsManagerState = { open: true, view: { kind: "detail", name: "scout", origin: "bundled" } };
  const renamed = [{ ...scout, used: 50, finished: 48 }];
  assert.ok(texts(layout(open, renamed)).some((line) => line.includes("used 50 · finished 48")));
  assert.ok(texts(layout(open, [mine])).includes("1 agent · helpers, last 30 days"));
});

test("a daemon without agents.list gets one plain line, other errors are shown as they are", () => {
  assert.deepEqual(agentListFailed(new RpcError(-32601, "method not found")), { agents: null, error: NO_AGENTS });
  assert.equal(NO_AGENTS, "this daemon has no agents yet");
  assert.deepEqual(agentListFailed(new Error("boom")), { agents: null, error: "boom" });
  const lines = texts(layout(openAgentsManager(), null, NO_AGENTS));
  assert.deepEqual(lines.slice(0, 3), ["Agents", "", NO_AGENTS]);
});

test("a short screen keeps the selected row on screen", () => {
  let state = openAgentsManager();
  for (let step = 0; step < 4; step += 1) {
    state = press1(state, "down");
  }
  const lines = layout(state, ALL, null, 6);
  assert.equal(lines.length, 6);
  assert.ok(lines.some((line) => line.selected === true));
});

const localScout: AgentInfo = {
  ...scout,
  resolves_to: { model: "qwen3:14b", tier: "local", reason: "the smallest local model that fits", fresh_window: false },
};
const cloudScout: AgentInfo = {
  ...scout,
  resolves_to: { model: "claude-haiku", tier: "budget", reason: "the cheapest model that fits", fresh_window: false },
};
const hostedWords = /hosted|cloud|budget|frontier/i;

test("a local-only setup: the list says what the wish becomes, with no hosted words", () => {
  const lines = texts(layout(openAgentsManager(), [localScout, { ...localScout, name: "deep", wish: "frontier" }], null, 40, "local"));
  assert.ok(lines.some((line) => line.includes("scout") && line.includes("wish: cheapest, now qwen3:14b")));
  assert.ok(lines.some((line) => line.includes("deep") && line.includes("wish: not available here")));
  assert.ok(!lines.some((line) => hostedWords.test(line)));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "scout", origin: "bundled" } }, [localScout], null, 40, "local"));
  assert.ok(detail.some((line) => line.startsWith("Why:") && line.includes("the smallest local model that fits")));
  assert.ok(detail.some((line) => line.startsWith("Wish:") && line.includes("cheapest, now qwen3:14b")));
});

test("a cloud-only setup: the list says what the wish becomes, with no local words", () => {
  const lines = texts(layout(openAgentsManager(), [cloudScout, { ...cloudScout, name: "home", wish: "local" }], null, 40, "cloud"));
  assert.ok(lines.some((line) => line.includes("scout") && line.includes("wish: cheapest, now claude-haiku")));
  assert.ok(lines.some((line) => line.includes("home") && line.includes("wish: not available here")));
  assert.ok(!lines.some((line) => /local/i.test(line)));
});

test("a stronger wish with a fresh window says so", () => {
  const fresh: AgentInfo = { ...localScout, wish: "stronger", resolves_to: { model: "qwen3:14b", tier: "local", fresh_window: true } };
  assert.ok(texts(layout(openAgentsManager(), [fresh], null, 40, "local")).some((line) => line.includes("wish: stronger than the lead, now qwen3:14b, fresh window")));
});

test("an older daemon without resolves_to shows the wish alone, and no why line", () => {
  const lines = texts(layout(openAgentsManager(), [scout]));
  assert.ok(lines.some((line) => line.includes("wish: cheapest ·")));
  assert.ok(!lines.some((line) => line.includes("now ")));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "scout", origin: "bundled" } }, [scout]));
  assert.ok(!detail.some((line) => line.startsWith("Why:")));
});

const DETAIL_SCOUT: AgentsManagerState = { open: true, view: { kind: "detail", name: "scout", origin: "bundled" } };
const LOCAL_MODELS = [
  { ref: "ollama/qwen3:14b", label: "qwen3:14b", status: "ready" as const },
  { ref: "ollama/gemma", label: "gemma", status: "not_installed" as const },
];
const CLOUD_MODELS = [{ ref: "anthropic/claude-haiku", label: "claude-haiku", status: "ready" as const }];

function pick(state: AgentsManagerState, agents: readonly AgentInfo[], key: AgentsManagerKey, setup: WishSetup, models: typeof LOCAL_MODELS) {
  return pressAgentsManager(state, agents, key, { setup, models });
}

test("w opens the choices in a detail, the footer says so, and the current one is marked", () => {
  assert.equal(agentsManagerKeyOf(press(null, "w")), "wish");
  assert.ok(texts(layout(DETAIL_SCOUT, [scout])).includes("w to change the wish · Esc to go back"));
  const opened = pick(DETAIL_SCOUT, [scout], "wish", "mixed", []).state;
  assert.deepEqual(opened.view, { kind: "detail", name: "scout", origin: "bundled", pick: { selected: 0 } });
  const lines = texts(layoutAgentsManager({ state: opened, agents: [scout], error: null, cwd: CWD, home: HOME, columns: 140, rows: 40 }));
  assert.ok(lines.includes("↑/↓ to choose · Enter to save · Esc to cancel"));
  assert.ok(lines.some((line) => line.includes("✔") && line.includes("Cheapest")));
});

test("local only: the choices name no hosted wish, and ready models are listed", () => {
  const opened = pick(DETAIL_SCOUT, [localScout], "wish", "local", LOCAL_MODELS).state;
  const lines = texts(layoutAgentsManager({ state: opened, agents: [localScout], error: null, cwd: CWD, home: HOME, columns: 140, rows: 40, setup: "local", models: LOCAL_MODELS }));
  assert.ok(lines.some((line) => line.includes("qwen3:14b")));
  assert.ok(!lines.some((line) => line.includes("gemma")));
  assert.ok(!lines.some((line) => hostedWords.test(line)));
});

test("cloud only: the choices have no local words", () => {
  const opened = pick(DETAIL_SCOUT, [cloudScout], "wish", "cloud", CLOUD_MODELS).state;
  const lines = texts(layoutAgentsManager({ state: opened, agents: [cloudScout], error: null, cwd: CWD, home: HOME, columns: 140, rows: 40, setup: "cloud", models: CLOUD_MODELS }));
  assert.ok(lines.some((line) => line.includes("claude-haiku")));
  assert.ok(!lines.some((line) => /local/i.test(line)));
});

test("arrows move, Enter saves the chosen wish, Esc cancels, and the same wish saves nothing", () => {
  const opened = pick(DETAIL_SCOUT, [scout], "wish", "cloud", []).state;
  const moved = pick(opened, [scout], "down", "cloud", []).state;
  const saved = pick(moved, [scout], "enter", "cloud", []);
  assert.deepEqual(saved.action, { kind: "set_wish", name: "scout", wish: "same" });
  assert.deepEqual(saved.state.view, { kind: "detail", name: "scout", origin: "bundled" });
  assert.deepEqual(pick(opened, [scout], "enter", "cloud", []).action, { kind: "none" });
  const cancelled = pick(moved, [scout], "back", "cloud", []);
  assert.deepEqual(cancelled.state.view, { kind: "detail", name: "scout", origin: "bundled" });
  assert.deepEqual(cancelled.action, { kind: "none" });
});

test("after saving, the row shows the new wish and now from the answer", () => {
  const answer: AgentInfo = { ...scout, wish: "stronger", resolves_to: { model: "claude-opus", reason: "one step above the lead", fresh_window: false } };
  const next = agentsWithSaved([scout, mine], answer);
  assert.equal(next[0], answer);
  assert.equal(next[1], mine);
  const lines = texts(layout(DETAIL_SCOUT, next, null, 40, "cloud"));
  assert.ok(lines.some((line) => line.startsWith("Wish:") && line.includes("now claude-opus")));
});

test("a refusal is one plain line and the old value stays; an old daemon says so", () => {
  const refused = agentWishFailed(DETAIL_SCOUT, new Error("this agent file is read-only"));
  const lines = texts(layout(refused, [scout]));
  assert.ok(lines.some((line) => line.includes("this agent file is read-only")));
  assert.ok(lines.some((line) => line.startsWith("Model:") && line.includes("Cheapest")));
  const old = agentWishFailed(DETAIL_SCOUT, new RpcError(-32601, "method not found"));
  assert.equal(old.view.kind === "detail" ? old.view.notice : "", WISH_OLD);
  assert.equal(WISH_OLD, "This golem is too old to change a wish. Update golem.");
});

test("a broken type and an untrusted project type have no w key and no hint", () => {
  for (const agent of [broken, untrusted]) {
    const state: AgentsManagerState = { open: true, view: { kind: "detail", name: agent.name, origin: agent.origin } };
    const pressed = pick(state, [agent], "wish", "mixed", []);
    assert.deepEqual(pressed.state, state);
    assert.ok(texts(layout(state, [agent])).includes("Esc to go back"));
  }
});
