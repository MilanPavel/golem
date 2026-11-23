import assert from "node:assert/strict";
import { test } from "node:test";

import { RpcError, type AgentInfo } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  agentEditProblems,
  agentListFailed,
  agentsFocused,
  agentsNoticed,
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
  problemText,
  type AgentsManagerKey,
  type AgentsManagerState,
} from "./agents-manager.ts";
import { AGENT_TEMPLATE, type WishSetup } from "@golem/view";

import { runsText } from "./agents-read.ts";

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

test("keys: arrows, pages, Enter, Esc, and the letters", () => {
  assert.equal(agentsManagerKeyOf(press("page-up")), "page-up");
  assert.equal(agentsManagerKeyOf(press("page-down")), "page-down");
  assert.equal(agentsManagerKeyOf(press("home")), "top");
  assert.equal(agentsManagerKeyOf(press("end")), "bottom");
  for (const [input, key] of [["w", "wish"], ["c", "copy"], ["e", "edit"], ["n", "new"], ["d", "delete"], ["y", "yes"]] as const) {
    assert.equal(agentsManagerKeyOf(press(null, input)), key);
  }
  assert.equal(agentsManagerKeyOf({ name: null, input: "c", ctrl: true, meta: false }), null);
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

test("the list groups the project's agents, then yours, then bundled, with origin, wish and runs", () => {
  const lines = texts(layout(openAgentsManager(), ALL));
  const at = (word: string) => lines.findIndex((line) => line.includes(word));
  assert.ok(at("This project (~/repo)") < at("Yours"));
  assert.ok(at("Yours") < at("Bundled with golem"));
  assert.ok(lines.some((line) => /scout +bundled +cheapest +41 runs$/.test(line)));
  assert.ok(lines.some((line) => /reviewer +yours +stronger than the lead +—$/.test(line)));
  assert.ok(lines.some((line) => /triage +project +same as the lead +2 runs$/.test(line)));
});

test("the list says not yet for an agent that cannot run, and shows what the wish becomes", () => {
  const waiting: AgentInfo = { ...localScout, name: "worker", unavailable: "no model is ready for this wish", used: 0 };
  const lines = texts(layout(openAgentsManager(), [localScout, waiting]));
  assert.ok(lines.some((line) => /scout +bundled +cheapest → qwen3:14b +41 runs$/.test(line)));
  assert.ok(lines.some((line) => /worker +bundled +cheapest → qwen3:14b +not yet$/.test(line)));
  assert.equal(runsText({ ...scout, used: 1 }), "1 run");
  assert.equal(runsText({ ...scout, used: 0 }), "—");
});

test("an untrusted project agent is marked and says why in the list and the detail", () => {
  const lines = texts(layout(openAgentsManager(), ALL));
  assert.ok(lines.some((line) => line.includes("! deploy") && line.includes("not trusted")));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "deploy", origin: "project" } }, ALL));
  assert.ok(detail.includes("Warnings"));
  assert.ok(detail.some((line) => line.includes("this folder is not trusted, so this agent is never started")));
  assert.ok(!detail.some((line) => line.startsWith("── prompt")));
});

test("a broken agent shows its error in the list and the detail", () => {
  const lines = texts(layout(openAgentsManager(), ALL));
  assert.ok(lines.some((line) => line.includes("✘ broken") && line.includes("the header is not valid YAML: line 3")));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "broken", origin: "user" } }, ALL));
  assert.ok(detail.includes("Errors"));
  assert.ok(detail.some((line) => line.includes("the header is not valid YAML: line 3")));
});

const PROMPTED: AgentInfo = {
  ...scout,
  path: "golem/agents/bundled/scout.md",
  changing_tools: ["write_file"],
  tools: ["read_file", "grep", "write_file"],
  limits: { max_calls: 15, max_seconds: 300, answer_chars: 6000 },
  prompt: "You are a helper.\n\nAnswer the brief. Read only what you need and end with a short answer: findings first, then the paths that matter.",
  text: "---\nname: scout\n---\nYou are a helper.",
  resolves_to: { model: "qwen3:14b", tier: "local", reason: "the smallest local model that fits", fresh_window: false },
};

test("Enter opens an agent: origin, path, model, tools, limits, asks, a rule, then the prompt", () => {
  let state = openAgentsManager();
  // The order shown is project (deploy, triage), user (reviewer, broken), bundled (scout).
  for (let step = 0; step < 4; step += 1) {
    state = press1(state, "down");
  }
  state = press1(state, "enter");
  assert.deepEqual(state.view, { kind: "detail", name: "scout", origin: "bundled" });
  const lines = texts(layoutAgentsManager({ state, agents: [PROMPTED], error: null, cwd: CWD, home: HOME, columns: 60, rows: 40, setup: "local" }));
  assert.equal(lines[0], "scout · bundled · read-only");
  assert.equal(lines[1], "golem/agents/bundled/scout.md");
  assert.ok(lines.some((line) => line.startsWith("model") && line.includes("cheapest, now qwen3:14b")));
  assert.ok(lines.some((line) => line.startsWith("why") && line.includes("the smallest local model that fits")));
  assert.ok(lines.some((line) => line.startsWith("tools") && line.includes("read_file grep write_file*")));
  assert.ok(lines.some((line) => line.includes("* changes things")));
  assert.ok(lines.some((line) => line.startsWith("limits") && line.includes("15 tool calls · 5 min · answer 6000 chars")));
  assert.ok(lines.some((line) => line.startsWith("asks") && line.includes("Never asks you")));
  assert.ok(lines.some((line) => line.startsWith("runs") && line.includes("41 runs in 30 days")));
  const rule = lines.findIndex((line) => line.startsWith("── prompt"));
  assert.ok(rule > 0);
  assert.equal(lines[rule + 1], "You are a helper.");
  assert.equal(lines[rule + 2], "");
  assert.ok(lines.slice(rule + 3).join(" ").includes("findings first, then the paths that matter."));
  assert.ok(lines.every((line) => line.length <= 60));
});

test("the read view marks only what is there, and shows an agent that cannot run", () => {
  const view = (agent: AgentInfo) => texts(layout({ open: true, view: { kind: "detail", name: agent.name, origin: agent.origin } }, [agent]));
  assert.ok(!view({ ...PROMPTED, changing_tools: [], tools: ["read_file"] }).some((line) => line.includes("changes things")));
  const waiting = view({ ...PROMPTED, unavailable: "no model is ready for this wish", used: 0 });
  assert.ok(waiting.some((line) => line.startsWith("not yet") && line.includes("no model is ready")));
  assert.ok(waiting.some((line) => line.startsWith("runs") && line.includes("Cannot run yet")));
  const hidden = view({ ...reviewer, prompt: null });
  assert.ok(hidden.some((line) => line.startsWith("hides")));
  assert.ok(hidden.some((line) => line.startsWith("limits") && line.includes("no tool calls limit")));
  assert.ok(!hidden.some((line) => line.startsWith("── prompt")));
  const asks = view({ ...mine, prompt: "x" });
  assert.ok(asks.some((line) => line.startsWith("asks") && line.includes("May ask you")));
});

test("a long prompt scrolls with the arrows, pages, home and end, and stops at both ends", () => {
  const long: AgentInfo = { ...PROMPTED, prompt: Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n") };
  const context = { setup: "mixed" as const, models: [], columns: 60, rows: 12 };
  const open: AgentsManagerState = { open: true, view: { kind: "detail", name: "scout", origin: "bundled" } };
  const step = (state: AgentsManagerState, key: AgentsManagerKey) => pressAgentsManager(state, [long], key, context).state;
  const show = (state: AgentsManagerState) => texts(layoutAgentsManager({ state, agents: [long], error: null, cwd: CWD, home: HOME, columns: 60, rows: 12 }));
  assert.equal(show(open).length, 12);
  assert.deepEqual(step(open, "up").view, open.view);
  const down = step(open, "down");
  assert.deepEqual(down.view, { kind: "detail", name: "scout", origin: "bundled", scroll: 1 });
  assert.notEqual(show(down)[0], show(open)[0]);
  const page = step(open, "page-down");
  assert.equal(page.view.kind === "detail" ? page.view.scroll : -1, 9);
  const end = step(open, "bottom");
  assert.ok(show(end).some((line) => line === "line 59"));
  assert.deepEqual(step(end, "down").view, end.view);
  assert.deepEqual(step(end, "top").view, open.view);
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
  assert.ok(texts(layout(open, renamed)).some((line) => line.startsWith("runs") && line.includes("50 runs in 30 days")));
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
  assert.ok(lines.some((line) => line.includes("scout") && line.includes("cheapest → qwen3:14b")));
  assert.ok(lines.some((line) => line.includes("deep") && line.includes("not available here")));
  assert.ok(!lines.some((line) => hostedWords.test(line)));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "scout", origin: "bundled" } }, [localScout], null, 40, "local"));
  assert.ok(detail.some((line) => line.startsWith("why") && line.includes("the smallest local model that fits")));
  assert.ok(detail.some((line) => line.startsWith("model") && line.includes("cheapest, now qwen3:14b")));
});

test("a cloud-only setup: the list says what the wish becomes, with no local words", () => {
  const lines = texts(layout(openAgentsManager(), [cloudScout, { ...cloudScout, name: "home", wish: "local" }], null, 40, "cloud"));
  assert.ok(lines.some((line) => line.includes("scout") && line.includes("cheapest → claude-haiku")));
  assert.ok(lines.some((line) => line.includes("home") && line.includes("not available here")));
  assert.ok(!lines.some((line) => /local/i.test(line)));
});

test("a stronger wish with a fresh window says so", () => {
  const fresh: AgentInfo = { ...localScout, wish: "stronger", resolves_to: { model: "qwen3:14b", tier: "local", fresh_window: true } };
  assert.ok(texts(layout(openAgentsManager(), [fresh], null, 40, "local")).some((line) => line.includes("stronger than the lead → qwen3:14b")));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "scout", origin: "bundled" } }, [fresh], null, 40, "local"));
  assert.ok(detail.some((line) => line.startsWith("model") && line.includes("stronger than the lead, now qwen3:14b, fresh window")));
});

test("an older daemon without resolves_to shows the wish alone, and no why line", () => {
  const lines = texts(layout(openAgentsManager(), [scout]));
  assert.ok(lines.some((line) => /scout +bundled +cheapest +41 runs$/.test(line)));
  assert.ok(!lines.some((line) => line.includes("→")));
  const detail = texts(layout({ open: true, view: { kind: "detail", name: "scout", origin: "bundled" } }, [scout]));
  assert.ok(!detail.some((line) => line.startsWith("why")));
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
  assert.ok(texts(layout(DETAIL_SCOUT, [scout])).includes("w model · c make my own copy · e edit (copy first) · ↑/↓ scroll · Esc back"));
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
  assert.ok(lines.some((line) => line.startsWith("model") && line.includes("now claude-opus")));
});

test("a refusal is one plain line and the old value stays; an old daemon says so", () => {
  const refused = agentWishFailed(DETAIL_SCOUT, new Error("this agent file is read-only"));
  const lines = texts(layout(refused, [scout]));
  assert.ok(lines.some((line) => line.includes("this agent file is read-only")));
  assert.ok(lines.some((line) => line.startsWith("model") && line.includes("cheapest")));
  const old = agentWishFailed(DETAIL_SCOUT, new RpcError(-32601, "method not found"));
  assert.equal(old.view.kind === "detail" ? old.view.notice : "", WISH_OLD);
  assert.equal(WISH_OLD, "This golem is too old to change a wish. Update golem.");
});

test("a broken type and an untrusted project type have no w key and no hint", () => {
  for (const agent of [broken, untrusted]) {
    const state: AgentsManagerState = { open: true, view: { kind: "detail", name: agent.name, origin: agent.origin } };
    const pressed = pick(state, [agent], "wish", "mixed", []);
    assert.deepEqual(pressed.state, state);
    assert.ok(texts(layout(state, [agent])).some((line) => line.endsWith("Esc back") && !line.includes("w model")));
  }
});

test("the list says how long a finished helper's steps are kept, and 0 is for ever", () => {
  const show = (keep: { keep_days: number; keep_problem_days: number } | null) =>
    texts(layoutAgentsManager({ state: openAgentsManager(), agents: ALL, error: null, cwd: CWD, home: HOME, columns: 140, rows: 40, keep })).filter((line) => line.startsWith("finished helpers"));
  assert.deepEqual(show({ keep_days: 7, keep_problem_days: 30 }), ["finished helpers: steps kept 7 days · failed, stopped or asking 30 days"]);
  assert.deepEqual(show({ keep_days: 1, keep_problem_days: 0 }), ["finished helpers: steps kept 1 day · failed, stopped or asking for ever"]);
  assert.deepEqual(show(null), []);
});

test("the list says the limits every helper gets, and nothing when none is set", () => {
  const show = (keep: Record<string, number | null>, setup: WishSetup = "mixed") =>
    texts(layoutAgentsManager({ state: openAgentsManager(), agents: ALL, error: null, cwd: CWD, home: HOME, columns: 140, rows: 40, keep: { keep_days: 7, keep_problem_days: 30, ...keep }, setup })).filter((line) => line.startsWith("every helper"));
  assert.deepEqual(show({ max_calls: 20, working_seconds: 600 }), ["every helper: 20 tool calls · 10 min"]);
  assert.deepEqual(show({ max_calls: 20, working_seconds: 90, max_cost: 1.5, max_tokens: 5000 }), ["every helper: 20 tool calls · 90 s · $1.50 cost · 5000 tokens"]);
  assert.deepEqual(show({ max_cost: 1.5, max_calls: 20 }, "cloud"), ["every helper: $1.50 cost · 20 tool calls"]);
  assert.deepEqual(show({ max_calls: null }), []);
  assert.deepEqual(show({}), []);
});

test("the read view shows tokens and cost when set, and marks what config.toml sets", () => {
  const view = (agent: AgentInfo) => texts(layout({ open: true, view: { kind: "detail", name: agent.name, origin: agent.origin } }, [agent]));
  const plain = view(PROMPTED);
  assert.ok(plain.some((line) => line.startsWith("limits") && line.endsWith("answer 6000 chars")));
  assert.ok(!plain.some((line) => line.includes("config.toml")));
  const set = view({ ...PROMPTED, limits: { max_calls: 15, max_seconds: 300, answer_chars: 6000, max_tokens: 8000, max_cost_usd: 1.5 }, limits_from_config: ["max_cost_usd", "max_calls"] });
  assert.ok(set.some((line) => line.startsWith("limits") && line.includes("answer 6000 chars · 8000 tokens · $1.50 cost")));
  assert.ok(set.some((line) => line.trim() === "tool calls, cost: set in config.toml"));
});

const FILES: AgentInfo[] = [
  { ...scout, text: "---\nname: scout\n---\nbody" },
  { ...reviewer, text: "---\nname: reviewer\n---\nbody", shadowed: ["bundled"] },
  { ...mine, path: ".golem/agents/triage.md" },
];
const in2 = (view: AgentsManagerState["view"]): AgentsManagerState => ({ open: true, view });

test("c on a bundled agent copies it, from the list and from the read view; other agents say why not", () => {
  // FILES in order shown: triage (project), reviewer (user), scout (bundled).
  const bundled = { kind: "list", selected: 2 } as const;
  assert.deepEqual(pressAgentsManager(in2(bundled), FILES, "copy").action, { kind: "copy", name: "scout" });
  const detail = pressAgentsManager(DETAIL_SCOUT, FILES, "copy");
  assert.deepEqual(detail.action, { kind: "copy", name: "scout" });
  const yours = pressAgentsManager(in2({ kind: "list", selected: 1 }), FILES, "copy");
  assert.deepEqual(yours.action, { kind: "none" });
  assert.equal(yours.state.view.kind === "list" ? yours.state.view.notice : "", "reviewer is already yours");
  const project = pressAgentsManager(in2({ kind: "list", selected: 0 }), FILES, "copy");
  assert.ok(texts(layout(project.state, FILES)).some((line) => line.includes("only a bundled agent is copied")));
});

test("after a copy the user copy is chosen: in the list its row, in the read view its read view", () => {
  const copy: AgentInfo = { ...scout, origin: "user", shadowed: ["bundled"] };
  const list = [...FILES, copy];
  // project (triage), user (reviewer, scout), bundled (scout)
  const fromList = agentsFocused(in2({ kind: "list", selected: 3 }), list, { name: "scout", origin: "user" }, "copied");
  assert.deepEqual(fromList.view, { kind: "list", selected: 2, notice: "copied" });
  const fromDetail = agentsFocused(DETAIL_SCOUT, list, { name: "scout", origin: "user" });
  assert.deepEqual(fromDetail.view, { kind: "detail", name: "scout", origin: "user" });
  const lost = agentsFocused(in2({ kind: "list", selected: 9 }), FILES, null);
  assert.deepEqual(lost.view, { kind: "list", selected: 2 });
});

test("e on your agent opens its text in the editor with its name; bundled and project agents say why not", () => {
  const user = pressAgentsManager(in2({ kind: "list", selected: 1 }), FILES, "edit");
  assert.deepEqual(user.action, { kind: "edit", text: "---\nname: reviewer\n---\nbody", name: "reviewer" });
  const bundled = pressAgentsManager(DETAIL_SCOUT, FILES, "edit");
  assert.deepEqual(bundled.action, { kind: "none" });
  assert.ok(texts(layout(bundled.state, FILES)).includes("make your own copy first (c)"));
  const project = pressAgentsManager(in2({ kind: "list", selected: 0 }), FILES, "edit");
  assert.ok(texts(layout(project.state, FILES)).some((line) => line.includes(".golem/agents/triage.md")));
  const noText = pressAgentsManager(in2({ kind: "list", selected: 0 }), [{ ...reviewer }], "edit");
  assert.deepEqual(noText.action, { kind: "none" });
});

test("a notice goes away on the next key", () => {
  const refused = pressAgentsManager(DETAIL_SCOUT, FILES, "edit").state;
  assert.equal(refused.view.kind === "detail" ? refused.view.notice : "", "make your own copy first (c)");
  assert.deepEqual(pressAgentsManager(refused, FILES, "down").state.view, DETAIL_SCOUT.view);
  const list = agentsNoticed(openAgentsManager(), "boom");
  assert.ok(texts(layout(list, FILES)).includes("boom"));
});

test("n starts a new agent from the template, in the list and in the read view", () => {
  const action = { kind: "edit", text: AGENT_TEMPLATE };
  assert.deepEqual(pressAgentsManager(openAgentsManager(), FILES, "new").action, action);
  assert.deepEqual(pressAgentsManager(DETAIL_SCOUT, FILES, "new").action, action);
  assert.deepEqual(pressAgentsManager(openAgentsManager(), [], "new").action, action);
});

test("a text with problems shows each with its line, keeps the text, and e opens it again or d drops it", () => {
  const edit = { text: "edited text", name: "reviewer" };
  const problems = [{ message: "model is not a wish", line: 4 }, { message: "the body is empty", line: null }, { message: "no name" }];
  const state = agentEditProblems(in2({ kind: "list", selected: 1 }), edit, problems);
  const lines = texts(layout(state, FILES));
  assert.equal(lines[0], "Not saved");
  assert.ok(lines.includes("✘ line 4: model is not a wish"));
  assert.ok(lines.includes("✘ the body is empty"));
  assert.ok(lines.includes("✘ no name"));
  assert.ok(lines.includes("e edit again · d drop the change · Esc drop the change"));
  assert.equal(problemText(problems[0] ?? { message: "" }), "line 4: model is not a wish");
  const again = pressAgentsManager(state, FILES, "edit");
  assert.deepEqual(again.action, { kind: "edit", text: "edited text", name: "reviewer" });
  assert.deepEqual(again.state.view, state.view);
  for (const key of ["delete", "back"] as const) {
    assert.deepEqual(pressAgentsManager(state, FILES, key).state.view, { kind: "list", selected: 1 });
  }
  assert.deepEqual(pressAgentsManager(state, FILES, "down").state.view, state.view);
  // A second round of problems keeps the first place to go back to; a new agent has no name.
  const second = agentEditProblems(state, { text: "again" }, problems);
  assert.deepEqual(second.view.kind === "problems" ? second.view.back : null, { kind: "list", selected: 1 });
  assert.equal(second.view.kind === "problems" ? second.view.name : "x", undefined);
});

test("d on your agent asks once: y deletes, any other key cancels; bundled and project agents say why not", () => {
  const asked = pressAgentsManager(in2({ kind: "list", selected: 1 }), FILES, "delete");
  assert.deepEqual(asked.action, { kind: "none" });
  assert.ok(texts(layout(asked.state, FILES)).includes("Delete reviewer? The bundled reviewer comes back. y to delete · any other key to cancel"));
  const yes = pressAgentsManager(asked.state, FILES, "yes");
  assert.deepEqual(yes.action, { kind: "delete", name: "reviewer" });
  assert.deepEqual(yes.state.view, { kind: "list", selected: 1 });
  for (const key of ["back", "down", "enter", "delete"] as const) {
    const no = pressAgentsManager(asked.state, FILES, key);
    assert.deepEqual(no.action, { kind: "none" });
    assert.deepEqual(no.state.view, { kind: "list", selected: 1 });
  }
  const detail = pressAgentsManager(in2({ kind: "detail", name: "reviewer", origin: "user" }), FILES, "delete");
  assert.equal(detail.state.view.kind === "detail" && detail.state.view.confirm, true);
  assert.deepEqual(pressAgentsManager(detail.state, FILES, "yes").action, { kind: "delete", name: "reviewer" });
  assert.ok(texts(layout(pressAgentsManager(DETAIL_SCOUT, FILES, "delete").state, FILES)).includes("a bundled agent cannot be deleted"));
  assert.ok(texts(layout(pressAgentsManager(in2({ kind: "list", selected: 0 }), FILES, "delete").state, FILES)).includes("a project agent is deleted by removing its file"));
  // The bundled one is back after the delete: the read view shows it.
  const back = agentsFocused(detail.state, [FILES[0] as AgentInfo], { name: "scout", origin: "bundled" }, "reviewer deleted");
  assert.deepEqual(back.view, { kind: "detail", name: "scout", origin: "bundled", notice: "reviewer deleted" });
});

test("the footers say what each view can do", () => {
  assert.ok(texts(layout(openAgentsManager(), ALL)).includes("↑/↓ move · Enter read · w model · u use helpers · c copy · e edit · n new · d delete · Esc close"));
  const user = in2({ kind: "detail", name: "reviewer", origin: "user" });
  assert.ok(texts(layout(user, ALL)).includes("w model · e edit · d delete · ↑/↓ scroll · Esc back"));
  const project = in2({ kind: "detail", name: "triage", origin: "project" });
  assert.ok(texts(layout(project, ALL)).includes("w model · ↑/↓ scroll · Esc back"));
});

test("w in the list opens the wish choices of the chosen agent", () => {
  const opened = pressAgentsManager(in2({ kind: "list", selected: 2 }), FILES, "wish");
  assert.deepEqual(opened.state.view, { kind: "detail", name: "scout", origin: "bundled", pick: { selected: 0 } });
});
