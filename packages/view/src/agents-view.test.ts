import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentInfo } from "@golem/client";

import { agentFinished, agentListLine, agentRow, agentRows, agentsTable, agentUsed, agentWish, asksLine, definitionLines, definitionPath, formatSeconds, limitFacts, toolGroups, usageLine, wishLine, wishNow, wishOptions, wishSetup } from "./agents-view.ts";

const bundled = (over: Partial<AgentInfo>): AgentInfo => ({
  name: "explorer",
  description: "Reads and searches.\nSecond line.",
  origin: "bundled",
  wish: "cheapest",
  used: 41,
  finished: 39,
  ...over,
});

const FIXTURES: AgentInfo[] = [
  bundled({}),
  bundled({ name: "worker", wish: "cheapest", asks: true, used: 0, finished: 0 }),
  bundled({ name: "reviewer", wish: "stronger", used: 20, finished: 19 }),
  bundled({ name: "advisor", wish: "stronger", tools: [], used: 4, finished: null }),
  { name: "docs", description: "Writes docs.", origin: "project", wish: "local", used: 3, finished: 3 },
];

test("the four bundled types and a project type make rows", () => {
  const rows = agentRows(FIXTURES);
  assert.deepEqual(
    rows.map((row) => [row.name, row.sourceLabel, row.wish, row.used, row.finished, row.tone]),
    [
      ["explorer", "comes with golem", "Cheapest that fits", "41", "39", "ok"],
      ["worker", "comes with golem", "Cheapest that fits", "—", "—", "ok"],
      ["reviewer", "comes with golem", "Stronger than the lead", "20", "19", "ok"],
      ["advisor", "comes with golem", "Stronger than the lead", "4", "—", "ok"],
      ["docs", "this project", "Always local", "3", "3", "ok"],
    ],
  );
  assert.equal(rows[0]?.description, "Reads and searches.");
});

test("wishes are words, and a model name stays as it is", () => {
  assert.equal(agentWish("same"), "Same as the lead");
  assert.equal(agentWish("budget"), "Always budget");
  assert.equal(agentWish("frontier"), "Always frontier");
  assert.equal(agentWish("claude-sonnet-4-5"), "claude-sonnet-4-5");
  assert.equal(agentWish("toString"), "toString");
});

test("an unused type shows a dash for both counts", () => {
  const unused = bundled({ used: 0, finished: null });
  assert.equal(agentUsed(unused), "—");
  assert.equal(agentFinished(unused), "—");
  assert.equal(agentFinished(bundled({ used: undefined, finished: undefined })), "—");
});

test("the table holds back a project agent of a folder that is not trusted, and names it", () => {
  const table = agentsTable([
    bundled({}),
    { name: "docs", description: "", origin: "project", wish: "same", trusted: false },
    { name: "mine", description: "", origin: "user", wish: "same" },
  ]);
  assert.deepEqual(table.rows.map((row) => row.name), ["explorer", "mine"]);
  assert.deepEqual(table.untrusted, ["docs"]);
});

test("errors give a bad row and an untrusted project agent a wait row", () => {
  const broken = agentRow(bundled({ origin: "user", errors: ["line 2: bad"] }));
  assert.equal(broken.tone, "bad");
  assert.deepEqual(broken.warnings, ["line 2: bad"]);
  const blocked = agentRow({ name: "docs", description: "", origin: "project", wish: "same", trusted: false });
  assert.equal(blocked.tone, "wait");
  assert.equal(blocked.warnings.length, 1);
  assert.equal(agentRow(bundled({ trusted: false })).tone, "ok");
});

const values = (current: string, setup: Parameters<typeof wishOptions>[1]): string[] => wishOptions(current, setup).map((option) => option.value);
const words = (setup: Parameters<typeof wishOptions>[1]): string =>
  wishOptions("cheapest", setup)
    .map((option) => `${option.label} ${option.hint}`)
    .join(" ");

test("the setup is told from the tiers of the model list", () => {
  assert.equal(wishSetup([{ tier: "local" }, { tier: "local" }]), "local");
  assert.equal(wishSetup([{ tier: "budget" }, { tier: "frontier" }]), "cloud");
  assert.equal(wishSetup([{ tier: "local" }, { tier: "budget" }]), "mixed");
  assert.equal(wishSetup([]), "mixed");
  assert.equal(wishSetup(null), "mixed");
  assert.equal(wishSetup(undefined), "mixed");
});

test("a mixed setup offers every wish", () => {
  assert.deepEqual(values("cheapest", "mixed"), ["cheapest", "same", "stronger", "local", "budget", "frontier"]);
  assert.match(words("mixed"), /paid model/);
});

test("local models only hides the hosted options and words", () => {
  assert.deepEqual(values("cheapest", "local"), ["cheapest", "same", "stronger", "local"]);
  const text = words("local").toLowerCase();
  for (const hosted of ["paid", "hosted", "budget", "frontier", "cloud"]) assert.equal(text.includes(hosted), false, hosted);
  assert.match(text, /fresh window/);
});

test("cloud models only hides the local option and words", () => {
  assert.deepEqual(values("cheapest", "cloud"), ["cheapest", "same", "stronger", "budget", "frontier"]);
  const text = words("cloud").toLowerCase();
  assert.equal(text.includes("local"), false);
  assert.equal(text.includes("computer"), false);
});

test("a model name as the wish comes first, so the dropdown shows what is set", () => {
  const options = wishOptions("claude-haiku", "cloud");
  assert.deepEqual([options[0]?.value, options[0]?.label], ["claude-haiku", "claude-haiku"]);
  assert.equal(options.length, 6);
  assert.deepEqual(values("local", "cloud")[0], "local");
});

test("now says the model, the reason and a fresh window in words, and is null without a model", () => {
  assert.deepEqual(wishNow({ model: "qwen3:14b", tier: "local", reason: "the cheapest that fits", fresh_window: true }), {
    text: "now: qwen3:14b",
    model: "qwen3:14b",
    tier: "local",
    reason: "the cheapest that fits",
    freshWindow: "fresh window",
  });
  assert.deepEqual(wishNow({ model: "claude-haiku", tier: "budget" }), { text: "now: claude-haiku", model: "claude-haiku", tier: "hosted", reason: "", freshWindow: "" });
  assert.deepEqual(wishNow({ model: "claude-haiku" }), { text: "now: claude-haiku", model: "claude-haiku", tier: null, reason: "", freshWindow: "" });
  assert.equal(wishNow(undefined), null);
  assert.equal(wishNow(null), null);
  assert.equal(wishNow({ reason: "no model" }), null);
});

test("a row carries the options for its setup, now, and no dropdown for a broken file", () => {
  const row = agentRow(bundled({ resolves_to: { model: "qwen3:14b", reason: "fits" } }), "local");
  assert.equal(row.wishValue, "cheapest");
  assert.deepEqual(row.wishOptions.map((option) => option.value), ["cheapest", "same", "stronger", "local"]);
  assert.equal(row.now?.text, "now: qwen3:14b");
  assert.equal(row.editable, true);
  assert.equal(agentRow(bundled({}), "mixed").now, null);
  assert.equal(agentRow(bundled({ errors: ["bad"] })).editable, false);
});

test("a ready model can be named in the wish dropdown, one that is not ready cannot", () => {
  const options = wishOptions("cheapest", "mixed", [
    { ref: "openai/gpt6-luna", label: "GPT-6 Luna", status: "ready" },
    { ref: "ollama/qwen3:8b", label: "Qwen3 8B", status: "not_installed" },
  ]);
  const luna = options.find((option) => option.value === "openai/gpt6-luna");
  assert.deepEqual(luna, { value: "openai/gpt6-luna", label: "GPT-6 Luna", hint: "this model, always" });
  assert.equal(options.some((option) => option.value === "ollama/qwen3:8b"), false);
  // The model that is set is listed once.
  assert.equal(wishOptions("openai/gpt6-luna", "mixed", [{ ref: "openai/gpt6-luna", label: "GPT-6 Luna", status: "ready" }]).filter((option) => option.value === "openai/gpt6-luna").length, 1);
});

test("wishLine: the wish, what it becomes, and the setup decides the words", () => {
  const now = { model: "qwen3:14b", tier: "local" as const, reason: "x", fresh_window: true };
  assert.equal(wishLine("cheapest", "local", now), "wish: cheapest, now qwen3:14b, fresh window");
  assert.equal(wishLine("cheapest", "mixed", undefined), "wish: cheapest");
  assert.equal(wishLine("frontier", "local", undefined), "wish: not available here");
  assert.equal(wishLine("local", "cloud", { model: "m" }), "wish: not available here, now m");
  assert.equal(wishLine("qwen3:14b", "local", null), "wish: qwen3:14b");
});

test("the usage line says runs, early stops and cost, and leaves out what is missing", () => {
  assert.equal(usageLine(bundled({ used: 9, stopped: 1, cost_usd: 0 })), "9 runs in 30 days · 1 stopped early · $0.00");
  assert.equal(usageLine(bundled({ used: 9, stopped: 0, cost_usd: 1.234 })), "9 runs in 30 days · $1.23");
  assert.equal(usageLine(bundled({ used: 1, stopped: null, cost_usd: null })), "1 run in 30 days");
  assert.equal(usageLine(bundled({ used: 0 })), "Not used yet");
  assert.equal(usageLine(bundled({ used: 5, unavailable: "agent worker is not available yet" })), "Cannot run yet");
});

test("the tools split into reading and changing ones, and the row carries the file", () => {
  const worker = bundled({
    name: "worker",
    tools: ["read_file", "edit_file", "grep"],
    changing_tools: ["edit_file"],
    path: "golem/agents/bundled/worker.md",
    text: "---\nname: worker\n---\nDo it.",
    prompt: "Do it.",
    unavailable: "agent worker is not available yet",
  });
  assert.deepEqual(toolGroups(worker), { reading: ["read_file", "grep"], changing: ["edit_file"] });
  const row = agentRow(worker);
  assert.equal(row.path, "golem/agents/bundled/worker.md");
  assert.equal(row.prompt, "Do it.");
  assert.equal(row.unavailable, "agent worker is not available yet");
  assert.deepEqual([row.readingTools, row.changingTools], [["read_file", "grep"], ["edit_file"]]);
  assert.equal(row.usage, "Cannot run yet");
  const old = agentRow(bundled({}));
  assert.deepEqual([old.path, old.text, old.unavailable, old.readingTools], [null, null, null, []]);
});

test("seconds are said in whole minutes only when they are whole", () => {
  assert.equal(formatSeconds(300), "5 min");
  assert.equal(formatSeconds(45), "45 s");
  assert.equal(formatSeconds(90), "90 s");
  assert.equal(formatSeconds(60), "1 min");
});

test("limits: three always, tokens and cost when set, no limit when the file sets none", () => {
  assert.deepEqual(limitFacts({ max_calls: 15, max_seconds: 300, answer_chars: 6000 }), [
    { value: "15", label: "tool calls" },
    { value: "5 min", label: "time" },
    { value: "6000", label: "answer chars" },
  ]);
  assert.deepEqual(limitFacts(undefined).map((fact) => fact.value), ["no limit", "no limit", "no limit"]);
  const more = limitFacts({ max_calls: 1, max_tokens: 5000, max_cost_usd: 0.5 });
  assert.deepEqual(more.slice(3), [{ value: "5000", label: "tokens" }, { value: "$0.50", label: "cost" }]);
  assert.equal(asksLine(true), "May ask you one short question.");
  assert.equal(asksLine(false), "Never asks you; it works from the brief.");
});

test("the list line says the wish and the model it becomes", () => {
  assert.equal(agentListLine("cheapest", { model: "qwen3:14b" }), "cheapest → qwen3:14b");
  assert.equal(agentListLine("stronger", { model: "gpt" }), "stronger than the lead → gpt");
  assert.equal(agentListLine("ollama/x", { model: "ollama/x" }), "ollama/x");
  assert.equal(agentListLine("cheapest", null), "cheapest");
});

test("the file text is split so front matter keys can be tinted, and the prompt never is", () => {
  const lines = definitionLines("---\nname: worker\ntools: a, b\n---\nnote: this is the prompt\n---\n");
  assert.deepEqual(
    lines.map((line) => line.kind),
    ["fence", "key", "key", "fence", "plain", "plain"],
  );
  assert.deepEqual(lines[1], { kind: "key", key: "name", text: " worker" });
  assert.deepEqual(definitionLines("no front matter\nkey: x").map((line) => line.kind), ["plain", "plain"]);
});

test("a bundled file's path says read-only", () => {
  assert.equal(definitionPath("golem/agents/bundled/explorer.md", "bundled"), "golem/agents/bundled/explorer.md · read-only");
  assert.equal(definitionPath("~/.golem/agents/x.md", "user"), "~/.golem/agents/x.md");
  assert.equal(definitionPath(null, "bundled"), null);
});

test("a row has its mark, list line, limits and tools note", () => {
  const row = agentRow(
    bundled({ origin: "user", wish: "cheapest", resolves_to: { model: "qwen3:14b", tier: "local" }, tools: ["read_file", "edit_file"], changing_tools: ["edit_file"], limits: { max_calls: 3 } }),
  );
  assert.deepEqual([row.mark, row.listLine, row.tier, row.toolsNote], ["yours", "cheapest → qwen3:14b", "local", "Marked tools change things."]);
  assert.equal(row.limits[0]?.value, "3");
  assert.equal(agentRow(bundled({ tools: [] })).toolsNote, "");
});
