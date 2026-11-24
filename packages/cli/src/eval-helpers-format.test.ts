import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvalMeasurement } from "../../protocol/gen/evals-get-result.ts";
import type { EvalPlanArm } from "../../protocol/gen/eval-plan-arm.ts";
import type { EvalSummary } from "../../protocol/gen/eval-summary.ts";
import {
  clock,
  costLine,
  formatAsks,
  formatList,
  formatMeasurement,
  formatPlan,
  formatProgress,
  memoryLine,
  parseHelpersArgs,
  refusals,
} from "./eval-helpers-format.ts";

const LOCAL: EvalPlanArm = {
  asks: 10,
  kind: "local",
  label: "Local 32K",
  model: "qwen3.8:27b",
  name: "local-32k",
  tier: "local",
  window: 32768,
  needed_gb: 21.1,
  free_gb: 24.3,
  ram_gb: 36,
  verdict: "tight",
  reason: "Tight: it fits but takes most of the memory.",
  minutes: 30,
};
const CLOUD: EvalPlanArm = {
  asks: 10,
  kind: "cloud",
  label: "Budget",
  model: "haiku",
  name: "budget-cloud",
  tier: "budget",
  window: 200000,
  cost_usd: 0.38,
  reason: "About $0.38.",
};

test("parse: the plan, a start, and the sub-commands", () => {
  assert.deepEqual(parseHelpersArgs([]), { kind: "start", arms: [], models: {}, allowTight: false, ownRisk: false });
  assert.deepEqual(parseHelpersArgs(["--arm", "a", "--own-risk"]), { kind: "start", arms: ["a"], models: {}, allowTight: false, ownRisk: true });
  assert.deepEqual(parseHelpersArgs(["--arm", "a", "--arm", "b", "--model", "a=x:1b", "--allow-tight"]), {
    kind: "start",
    arms: ["a", "b"],
    models: { a: "x:1b" },
    allowTight: true,
    ownRisk: false,
  });
  assert.deepEqual(parseHelpersArgs(["list"]), { kind: "list" });
  assert.deepEqual(parseHelpersArgs(["show", "7f3a"]), { kind: "show", id: "7f3a", verbose: false });
  assert.deepEqual(parseHelpersArgs(["show", "7f3a", "--ask", "rename", "--verbose"]), { kind: "show", id: "7f3a", ask: "rename", verbose: true });
  assert.deepEqual(parseHelpersArgs(["asks"]), { kind: "asks" });
  assert.deepEqual(parseHelpersArgs(["stop"]), { kind: "stop" });
  assert.deepEqual(parseHelpersArgs(["stop", "7f3a"]), { kind: "stop", id: "7f3a" });
  assert.deepEqual(parseHelpersArgs(["resume", "7f3a", "--allow-tight"]), { kind: "resume", id: "7f3a", allowTight: true, ownRisk: false });
  assert.deepEqual(parseHelpersArgs(["resume", "7f3a", "--own-risk"]), { kind: "resume", id: "7f3a", allowTight: false, ownRisk: true });
  assert.deepEqual(parseHelpersArgs(["apply", "7f3a"]), { kind: "apply", id: "7f3a" });
  assert.deepEqual(parseHelpersArgs(["delete", "7f3a"]), { kind: "delete", id: "7f3a" });
});

test("parse: wrong arguments are errors", () => {
  for (const args of [["show"], ["show", "7f3a", "--ask"], ["asks", "x"], ["list", "x"], ["resume"], ["--arm"], ["--model", "nope"], ["--model", "a="], ["--bogus"], ["x"], ["apply", "--x"]]) {
    assert.equal(parseHelpersArgs(args).kind, "error", args.join(" "));
  }
});

test("the memory line and the plan", () => {
  assert.equal(memoryLine(LOCAL), "memory  qwen3.8:27b at 32K needs 21.1 GB · 24.3 GB free of 36 GB · tight");
  const text = formatPlan([LOCAL, CLOUD], null);
  assert.match(text, /local-32k {2}\(local, qwen3.8:27b, 32K window, 10 asks, about 30 min\)/);
  assert.match(text, /cost {4}about \$0.38 for all its runs/);
  assert.match(text, /--allow-tight/);
  assert.match(text, /nothing was started\.$/);
  assert.doesNotMatch(text, /\u001b/);
  assert.match(formatPlan([CLOUD], "7f3a"), /is running.*show 7f3a/);
});

test("refusals: unknown, too big, no room, tight", () => {
  const big = { ...LOCAL, name: "big", verdict: "too_big" as const, reason: "Too big." };
  const full = { ...LOCAL, name: "full", verdict: "no_room" as const, reason: "No room now." };
  const plan = [LOCAL, CLOUD, big, full];
  assert.deepEqual(refusals(plan, ["budget-cloud"], false), []);
  assert.deepEqual(refusals(plan, ["local-32k"], true), []);
  assert.match(refusals(plan, ["local-32k"], false)[0] ?? "", /tight on memory.*Save your work.*--allow-tight/);
  assert.match(refusals(plan, ["big"], true)[0] ?? "", /big is too big.*your own risk.*--own-risk/);
  assert.match(refusals(plan, ["full"], true)[0] ?? "", /full is no room now.*--own-risk/);
  // the own risk flag lets every memory verdict run
  assert.deepEqual(refusals(plan, ["big", "full", "local-32k"], false, true), []);
  const gone = { ...LOCAL, name: "gone", verdict: "unknown" as const, reason: "Ollama does not have qwen3.8:27b. Choose another model, or pull it first." };
  assert.match(refusals([gone], ["gone"], true, true)[0] ?? "", /gone cannot run \(not installed\): Ollama does not have qwen3.8:27b\. Choose another model, or pull it first\./);
  assert.match(memoryLine(gone), /· not installed$/);
  assert.match(refusals(plan, ["nope"], true)[0] ?? "", /unknown arm nope \(arms: local-32k, budget-cloud/);
});

test("the cost line names paid arms only", () => {
  assert.equal(costLine([LOCAL, CLOUD], ["local-32k"]), null);
  assert.equal(costLine([LOCAL, CLOUD], ["local-32k", "budget-cloud"]), "cost    budget-cloud: about $0.38");
});

test("clock and a progress line", () => {
  assert.equal(clock(42), "0:42");
  assert.equal(clock(760), "12:40");
  assert.equal(clock(3723), "1:02:03");
  assert.equal(
    formatProgress({ arm: "local-32k", ask: "read-big", elapsed: 42, id: "7f3a", index: 2, mode: "on", state: "completed", total: 20, memory_used_gb: 21.14, memory_total_gb: 36 }),
    "run 3 of 20  local-32k  on  read-big  completed  0:42  mem 21.1/36 GB",
  );
  assert.equal(
    formatProgress({ arm: "a", ask: "b", elapsed: 0, id: "x", index: 0, mode: "off", state: "running", total: 2 }),
    "run 1 of 2  a  off  b  running  0:00",
  );
});

test("list: today, another day, states", () => {
  const now = new Date(2026, 10, 24, 18, 0);
  const items: EvalSummary[] = [
    { id: "7f3a", arms: [{ name: "local-32k", model: "m" }], started_at: new Date(2026, 10, 24, 14, 2).toISOString(), state: "stopped", stop_reason: "Ollama stopped answering at run 6", runs_played: 5, runs_total: 20 },
    { id: "5c1e", arms: [{ name: "budget-cloud", model: "m" }], started_at: new Date(2026, 10, 21, 9, 0).toISOString(), state: "done", cost_usd: 0.38, runs_played: 20, runs_total: 20, in_use: true },
    { id: "9d", arms: [{ name: "a", model: "m" }, { name: "b", model: "m" }], started_at: new Date(2026, 10, 24, 17, 0).toISOString(), state: "running", runs_played: 3, runs_total: 8 },
  ];
  const lines = formatList(items, now).split("\n");
  assert.equal(lines[0], "7f3a  today 14:02  local-32k     stopped  Ollama stopped answering at run 6");
  assert.equal(lines[1], "5c1e  21 Nov       budget-cloud  done     20 runs · $0.38 · in use");
  assert.equal(lines[2], "9d    today 17:00  a,b           running  run 4 of 8");
  assert.match(formatList([], now), /^no measurement yet/);
});

function measurement(over: Partial<EvalMeasurement> = {}): EvalMeasurement {
  return {
    id: "7f3a",
    arms: [{ name: "local-32k", model: "m" }],
    started_at: "2026-11-24T10:00:00.000Z",
    ended_at: "2026-11-24T10:34:10.000Z",
    state: "done",
    runs: [
      { arm: "local-32k", ask: "a", mode: "on", end: "completed", quality: 0.8, seconds: 60, window_left: 0.6, helpers_started: 2 },
      { arm: "local-32k", ask: "b", mode: "on", end: "completed", quality: 1, seconds: 120, window_left: 0.4, helpers_started: 1 },
      { arm: "local-32k", ask: "a", mode: "off", end: "completed", quality: 0.7, seconds: 50, window_left: 0.3, helpers_started: 0 },
      { arm: "local-32k", ask: "b", mode: "off", end: "not_run" },
    ],
    proposal: {
      pairs: 1,
      wins: 1,
      numbers: [
        { key: "read_share", current: 0.3, measured: true, proposed: 0.42 },
        { key: "job_share", current: 0.1, measured: false, note: "cloud arms" },
      ],
    },
    ...over,
  };
}

test("show: the head, the table, the proposal and what to run next", () => {
  const text = formatMeasurement(measurement());
  const lines = text.split("\n");
  assert.equal(lines[0], "measurement 7f3a · done in 34:10 · 3 of 4 runs");
  assert.match(text, /local-32k +on +2\/2 +0\.90 +1:30 +50% +1\.5/);
  assert.match(text, /local-32k +off +1\/2 +0\.70/);
  assert.match(text, /read_share +0\.3 -> 0\.42/);
  assert.match(text, /job_share +0\.1 +not measured: cloud arms/);
  assert.match(text, /helpers did better in 1 of 1 paired asks/);
  assert.match(text, /golem eval helpers apply 7f3a/);
  assert.doesNotMatch(text, /\u001b/);
});

test("show: a stopped measurement says why and how to go on; no proposal is said", () => {
  const text = formatMeasurement(measurement({ state: "stopped", stop_reason: "Ollama stopped answering", proposal: null, ended_at: null }));
  assert.match(text, /^measurement 7f3a · stopped · 3 of 4 runs/);
  assert.match(text, /stopped: Ollama stopped answering/);
  assert.match(text, /no proposal/);
  assert.match(text, /resume 7f3a/);
  assert.doesNotMatch(text, /apply 7f3a/);
});

test("asks, parameters and the details of a run", () => {
  const ask = { name: "rename", text: "rename old_name to new_name everywhere", facts: ["new_name", "six or 6"], setup: "6 small files", reason: "none" as const, why: "A plain ask: no helper is needed." };
  const text = formatAsks([ask]);
  assert.match(text, /rename\n {2}message {2}rename old_name to new_name everywhere\n {2}set-up {3}6 small files · A plain ask/);
  assert.match(text, /must mention {2}new_name; six or 6/);
  const measurement = {
    id: "7f3a",
    started_at: "2026-11-24T14:00:00Z",
    ended_at: "2026-11-24T14:10:00Z",
    state: "done" as const,
    arms: [{ name: "local-32k", model: "ollama/qwen3.8:27b" }],
    asks: [ask],
    own_risk: true,
    golem_version: "0.9.1",
    rules: { read_share: 0.3 },
    arm_params: [{ name: "local-32k", model: "ollama/qwen3.8:27b", window: 32768, at_a_time: 1, helper_model: "the same model" }],
    runs: [
      { arm: "local-32k", ask: "rename", mode: "off" as const, end: "completed" as const, quality: 0.5, seconds: 5, window_left: 0.5, helpers_started: 0, answer: "Renamed to new_name.", found: ["new_name"], missing: ["six or 6"] },
    ],
  };
  const shown = formatMeasurement(measurement);
  assert.match(shown, /parameters\n {2}local-32k · ollama\/qwen3.8:27b · window 32,768 tokens · 1 request at a time · helpers use the same model/);
  assert.match(shown, /helper rules: read_share 0.3/);
  assert.match(shown, /golem 0.9.1/);
  assert.match(shown, /own risk/);
  assert.match(shown, /show 7f3a --verbose/);
  assert.doesNotMatch(shown, /answer {3}/);
  const verbose = formatMeasurement(measurement, { verbose: true });
  assert.match(verbose, /rename {2}local-32k {2}helpers off {2}completed {2}quality 0.50/);
  assert.match(verbose, /message {2}rename old_name to new_name everywhere\n {2}found {4}new_name\n {2}missing {2}six or 6\n {2}answer {3}Renamed to new_name\./);
  assert.match(formatMeasurement(measurement, { ask: "nothing" }), /no run of that ask was played/);
});
