import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent, ConfigRouting, CostGetResult, ListedModel, ModelRoutedData } from "@golem/client";

import { emptyChat, reduceChat } from "./chat-state.ts";
import { applyComposer, closedDebug } from "./commands.ts";
import {
  emptyRoute,
  foldRoute,
  isRouteMode,
  ladderRows,
  routeForSpan,
  routeHeadline,
  routeLabel,
  routeReport,
  routeReportLines,
  routeStatus,
  routedNote,
  sessionModelOf,
  spendRows,
  turnRoutedNote,
  waitHint,
  whyLines,
  whyRows,
  whySummary,
  type SessionModelRef,
} from "./route.ts";

function ev(type: string, data: Record<string, unknown>, runId: string | null = "r1"): ChatEvent {
  return { seq: 1, session_id: "s", run_id: runId, ts: "t", type, data } as ChatEvent;
}

function listed(ref: string, extra: Partial<ListedModel> = {}): ListedModel {
  return {
    ref,
    label: ref.slice(ref.indexOf("/") + 1),
    provider: ref.slice(0, ref.indexOf("/")),
    source: "remote",
    status: "ready",
    tier: "frontier",
    ...extra,
  };
}

const QWEN = listed("ollama/qwen3:27b", {
  tier: "local",
  source: "installed",
  ctx: 32768,
  price: { input: 0, output: 0 },
  speed: { prompt_tps: 100, samples: 4 },
});
const SMALL = listed("ollama/qwen3:8b", { tier: "local", source: "installed", ctx: 8192, price: { input: 0, output: 0 } });
const DEEPSEEK = listed("deepseek/deepseek-chat", { tier: "budget", price: { input: 0.28, output: 1.1 }, tools: true });
const CHEAP_NOKEY = listed("openrouter/mini", { tier: "budget", status: "needs_key", price: { input: 0.1, output: 0.4 } });
const OPUS = listed("anthropic/opus", { tier: "frontier", price: { input: 15, output: 75 } });

const SESSION: SessionModelRef = { profile: "local", provider: "ollama", name: "qwen3:27b", tier: "local" };

function routed(extra: Partial<ModelRoutedData> = {}): ModelRoutedData {
  return {
    model_profile: "deepseek/deepseek-chat",
    provider: "deepseek",
    model: "deepseek-chat",
    tier: "budget",
    reason: "fit",
    detail: "did not fit in 32K on ollama/qwen3:27b",
    rejected: [{ ref: "ollama/qwen3:27b", tier: "local", why: "does not fit: 41.5K of 32K" }],
    ...extra,
  };
}

test("routeLabel names the three modes and never says balanced", () => {
  assert.deepEqual(["pinned", "local", "auto"].map((mode) => routeLabel(mode as "pinned")), ["pinned", "local", "auto"]);
  assert.equal(isRouteMode("balanced"), false);
  assert.equal(isRouteMode("auto"), true);
  assert.equal(routeStatus("pinned"), "");
  assert.equal(routeStatus("auto"), "auto");
});

test("the reducer keeps the mode and the pick of each run", () => {
  let state = reduceChat(emptyChat, ev("session.created", { model_profile: "local", route: "local" }, null));
  assert.equal(state.route.mode, "local");
  state = reduceChat(state, ev("session.updated", { route: "auto" }, null));
  assert.equal(state.route.mode, "auto");
  const same = reduceChat(state, ev("session.updated", { title: "x" }, null));
  assert.equal(same.route, state.route);
  state = reduceChat(state, ev("model.routed", { ...routed() }, "r1"));
  state = reduceChat(state, ev("model.routed", { ...routed({ reason: "cheapest", detail: "cheapest ready" }) }, "r2"));
  assert.deepEqual(Object.keys(state.route.routed), ["r1", "r2"]);
  assert.equal(state.route.routed["r1"]?.reason, "fit");
  assert.equal(state.route.last?.reason, "cheapest");
  assert.equal(foldRoute(emptyRoute, ev("run.started", {})), emptyRoute);
});

test("routedNote: empty for the session's own model, an arrow only when the tier is higher", () => {
  const cases: [string, ModelRoutedData | null, SessionModelRef, string][] = [
    ["nothing routed", null, SESSION, ""],
    ["the session's model", routed({ model_profile: "local", provider: "ollama", model: "qwen3:27b", tier: "local" }), SESSION, ""],
    ["by profile", routed({ model_profile: "local", model: null, provider: null, tier: "local" }), SESSION, ""],
    ["pinned", routed({ reason: "pinned" }), SESSION, ""],
    ["a tier up", routed(), SESSION, "↑ deepseek-chat · did not fit in 32K"],
    ["same tier", routed({ tier: "local", model: "qwen3:8b", model_profile: "ollama/qwen3:8b" }), SESSION, "qwen3:8b · did not fit in 32K"],
    ["tier unknown", routed(), { ...SESSION, tier: null }, "deepseek-chat · did not fit in 32K"],
    ["a tier down", routed({ detail: "the budget is spent", reason: "budget", tier: "local", model: "qwen3:8b" }), { ...SESSION, name: "opus", profile: "opus", tier: "frontier" }, "qwen3:8b · the budget is spent"],
    ["a detail that names no model", routed({ detail: "this chat stays on this Mac", reason: "privacy" }), SESSION, "↑ deepseek-chat · this chat stays on this Mac"],
  ];
  for (const [name, pick, session, expected] of cases) {
    assert.equal(routedNote(pick, session), expected, name);
  }
});

test("turnRoutedNote reads the pick of the run that wrote the steps", () => {
  const route = { routed: { r1: routed() } };
  assert.equal(turnRoutedNote([{ runId: "r0" }, { runId: "r1" }], route, SESSION), "↑ deepseek-chat · did not fit in 32K");
  assert.equal(turnRoutedNote([{ runId: "r9" }], route, SESSION), "");
  assert.equal(turnRoutedNote([{}], route, SESSION), "");
  assert.equal(turnRoutedNote([{ runId: "r1" }], route, null), "");
  assert.equal(turnRoutedNote([{ runId: "r1" }], undefined, SESSION), "");
});

test("sessionModelOf takes the tier from the listing", () => {
  const own = sessionModelOf({ profile: null, provider: "ollama", name: "qwen3:27b" }, [QWEN, DEEPSEEK]);
  assert.equal(own.tier, "local");
  assert.equal(sessionModelOf({ profile: "x", provider: null, name: null }, [QWEN]).tier, null);
  assert.equal(sessionModelOf({ profile: "x", provider: null, name: null }, null).tier, null);
});

test("ladderRows: one row per tier, with the state of its model", () => {
  const rows = ladderRows([QWEN, SMALL, DEEPSEEK, OPUS], null, SESSION);
  assert.deepEqual(
    rows.map((row) => [row.tier, row.model, row.state, row.ready]),
    [
      ["local", "qwen3:27b", "ready \u00b7 free", true],
      ["budget", "deepseek-chat", "ready \u00b7 $0.28 / M in", true],
      ["frontier", null, "no model", false],
    ],
  );
});

test("ladderRows: a tier with a missing key is not ready and offers the key", () => {
  const rows = ladderRows([QWEN, CHEAP_NOKEY], null, SESSION);
  const budget = rows.find((row) => row.tier === "budget");
  assert.equal(budget?.state, "needs key");
  assert.equal(budget?.needsKey, true);
  assert.equal(budget?.ready, false);
  assert.equal(budget?.provider, "openrouter");
});

test("ladderRows: the ladder in config wins, and a frontier session fills its tier", () => {
  const routing: ConfigRouting = { ladder: { local: "ollama/qwen3:8b", budget: "anthropic/opus" } };
  const rows = ladderRows([QWEN, SMALL, DEEPSEEK, OPUS], routing, SESSION);
  assert.equal(rows[0]?.model, "qwen3:8b");
  assert.equal(rows[1]?.model, "opus");
  const own = { profile: null, provider: "anthropic", name: "opus", tier: "frontier" } as const;
  assert.equal(ladderRows([QWEN, OPUS], null, own)[2]?.model, "opus");
  assert.equal(ladderRows([QWEN, SMALL], null, null)[0]?.model, "qwen3:27b");
});

test("ladderRows: a model that is not installed or running says so", () => {
  const rows = ladderRows([listed("ollama/big", { tier: "local", status: "not_installed" })], { ladder: { local: "ollama/big" } });
  assert.equal(rows[0]?.state, "not installed");
  const down = ladderRows([listed("ollama/big", { tier: "local", status: "server_down" })], { ladder: { local: "ollama/big" } });
  assert.equal(down[0]?.state, "not running");
});

function cost(today: number, session: number | null): CostGetResult {
  const totals = (usd: number) => ({ calls: 1, input: 1, output: 1, cost_usd: usd, saved_usd: 0 });
  return { today: totals(today), week: totals(today), ...(session === null ? {} : { session: totals(session) }) };
}

test("spendRows: amounts with caps, amounts alone without", () => {
  const capped = spendRows(cost(0.42, 0.03), { ladder: {}, daily_usd: 2, session_usd: 0.5 });
  assert.deepEqual(
    capped.map((row) => [row.text, row.ratio]),
    [
      ["Today $0.42 of $2.00", 0.21],
      ["This session $0.03 of $0.50", 0.06],
    ],
  );
  const open = spendRows(cost(0.42, null), null);
  assert.deepEqual(
    open.map((row) => [row.text, row.ratio]),
    [
      ["Today $0.42", null],
      ["This session $0.00", null],
    ],
  );
  assert.equal(spendRows(cost(5, 0), { ladder: {}, daily_usd: 2 })[0]?.ratio, 1);
  assert.equal(spendRows(cost(0, 0), { ladder: {}, daily_usd: 0 })[0]?.ratio, 1);
  assert.deepEqual(spendRows(null, null), []);
});

test("whyRows: the picked model first, then each rejected one with its reason", () => {
  assert.deepEqual(whyRows(routed()), [
    { model: "deepseek-chat", tier: "budget", result: "picked: did not fit in 32K on ollama/qwen3:27b" },
    { model: "ollama/qwen3:27b", tier: "local", result: "does not fit: 41.5K of 32K" },
  ]);
  assert.deepEqual(whyRows({ detail: "cheapest ready" }), [{ model: "-", tier: "-", result: "picked: cheapest ready" }]);
  assert.equal(routeHeadline("fit", "auto"), "Route: auto · reason: fit");
  assert.equal(routeHeadline("fit", null), "Route · reason: fit");
});

test("whyLines and whySummary print the table", () => {
  assert.deepEqual(whyLines(routed(), "auto"), [
    "Route: auto · reason: fit",
    "Model             Tier    Result",
    "deepseek-chat     budget  picked: did not fit in 32K on ollama/qwen3:27b",
    "ollama/qwen3:27b  local   does not fit: 41.5K of 32K",
  ]);
  assert.equal(
    whySummary({ mode: "auto", last: routed() }),
    "Route: auto · reason: fit. deepseek-chat picked: did not fit in 32K on ollama/qwen3:27b. Left out: ollama/qwen3:27b (does not fit: 41.5K of 32K)",
  );
  assert.equal(whySummary({ mode: "auto", last: null }), "No model was routed in this chat yet.");
});

test("routeReportLines: the mode, the ladder and the spend", () => {
  const ladder = ladderRows([QWEN, DEEPSEEK], null, SESSION);
  const lines = routeReportLines("auto", ladder, spendRows(cost(0.42, 0.03), { ladder: {}, daily_usd: 2 }));
  assert.equal(lines[0], "Route: auto. /route pinned, local or auto sets it; /route why says why the last model.");
  assert.ok(lines.includes("The ladder"));
  assert.ok(lines.some((line) => line.startsWith("local") && line.endsWith("ready · free")));
  assert.ok(lines.some((line) => line.startsWith("budget") && line.endsWith("ready · $0.28 / M in")));
  assert.ok(lines.includes("Today $0.42 of $2.00"));
  assert.ok(lines.includes("This session $0.03"));
  assert.match(routeReport("local"), /^Route: local\./);
});

test("routeForSpan: a run's route, and the first model call of that run", () => {
  const route = { reason: "fit", detail: "d" } as const;
  const runs = [
    { id: "r1", route, children: [{ id: "m1" }, { id: "m2" }] },
    { id: "r2", route: null, children: [{ id: "m3" }] },
  ];
  assert.equal(routeForSpan(runs, "r1"), route);
  assert.equal(routeForSpan(runs, "m1"), route);
  assert.equal(routeForSpan(runs, "m2"), null);
  assert.equal(routeForSpan(runs, "m3"), null);
  assert.equal(routeForSpan(runs, "r2"), null);
});

test("waitHint: a slow local model, with the budget model on auto", () => {
  const base = { mode: "pinned", session: QWEN, models: [QWEN, DEEPSEEK], routing: null, inputTokens: 18_000 } as const;
  assert.equal(waitHint(base), "≈ 3 min to first token on qwen3:27b");
  assert.equal(waitHint({ ...base, mode: "local" }), "≈ 3 min to first token on qwen3:27b");
  assert.equal(
    waitHint({ ...base, mode: "auto" }),
    "≈ 3 min to first token on qwen3:27b · deepseek-chat ≈ 2 s for ≈ $0.01",
  );
  assert.equal(waitHint({ ...base, mode: "auto", models: [QWEN, CHEAP_NOKEY] }), "≈ 3 min to first token on qwen3:27b");
  assert.equal(waitHint({ ...base, inputTokens: 6000 }), "", "exactly a minute is not over a minute");
  assert.equal(waitHint({ ...base, inputTokens: 6100 }), "≈ 1 min to first token on qwen3:27b");
  assert.equal(waitHint({ ...base, inputTokens: null }), "");
  assert.equal(waitHint({ ...base, session: DEEPSEEK }), "");
  assert.equal(waitHint({ ...base, session: undefined }), "");
  assert.equal(waitHint({ ...base, session: { ...QWEN, speed: null } }), "");
  assert.equal(waitHint({ ...base, inputTokens: 400_000 }), "≈ 1 h to first token on qwen3:27b");
});

test("/route reads a mode, why, or nothing", () => {
  assert.deepEqual(applyComposer(closedDebug, "/route"), { kind: "route", mode: "show" });
  assert.deepEqual(applyComposer(closedDebug, "/route auto"), { kind: "route", mode: "auto" });
  assert.deepEqual(applyComposer(closedDebug, "/route pinned"), { kind: "route", mode: "pinned" });
  assert.deepEqual(applyComposer(closedDebug, "/route local"), { kind: "route", mode: "local" });
  assert.deepEqual(applyComposer(closedDebug, "/route why"), { kind: "route", mode: "why" });
  assert.equal(applyComposer(closedDebug, "/route balanced").kind, "unknown");
  assert.equal(applyComposer(closedDebug, "/route auto now").kind, "unknown");
});
