import assert from "node:assert/strict";
import { test } from "node:test";

import { RpcError, type AgentInfo } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  agentCounts,
  agentListFailed,
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

function layout(state: AgentsManagerState, agents: readonly AgentInfo[] | null, error: string | null = null, rows = 40) {
  return layoutAgentsManager({ state, agents, error, cwd: CWD, home: HOME, columns: 100, rows });
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
