import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent, CostGetResult } from "@golem/client";

import { emptyChat, reduceChat, type ChatMessage } from "./chat-state.ts";
import { costReportLines, formatCost, helperCost, sessionCostLabel, turnFooterParts, turnTotals } from "./cost.ts";
import { turnFooter } from "./turns.ts";

function ev(type: string, data: Record<string, unknown>): ChatEvent {
  return { seq: 1, session_id: "s", run_id: "r", ts: "t", type, data } as ChatEvent;
}

test("formatCost: null is empty, zero is $0.00, under a cent is three decimals, else two", () => {
  assert.equal(formatCost(null), "");
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.004), "$0.004");
  assert.equal(formatCost(0.00949), "$0.009");
  assert.equal(formatCost(0.01), "$0.01");
  assert.equal(formatCost(0.309), "$0.31");
  assert.equal(formatCost(12), "$12.00");
});

function runOfThreeCalls(): ChatMessage[] {
  let state = emptyChat;
  const calls = [
    ["m1", "qwen3:27b", "local", { input: 1000, output: 100 }, 0],
    ["m2", "deepseek-chat", "budget", { input: 2000, output: 200 }, 0.004],
    ["m3", "deepseek-chat", "budget", { input: 3000, output: 300 }, undefined],
  ] as const;
  for (const [id, model, tier, usage, cost] of calls) {
    state = reduceChat(state, ev("model.call.started", { message_id: id, model, tier }));
    state = reduceChat(state, ev("message.started", { message_id: id }));
    const done = { message_id: id, usage, ...(cost === undefined ? {} : { cost_usd: cost }) };
    state = reduceChat(state, ev("model.call.completed", done));
  }
  return state.messages;
}

test("each reply keeps its call, and a call with no cost stays null", () => {
  const messages = runOfThreeCalls();
  assert.deepEqual(messages[1]?.call, { model: "deepseek-chat", tier: "budget", tokens: 2200, costUsd: 0.004, done: true });
  assert.deepEqual(messages[2]?.call, { model: "deepseek-chat", tier: "budget", tokens: 3300, costUsd: null, done: true });
});

test("the run's totals add three calls, one without a cost, and name the last model", () => {
  const messages = runOfThreeCalls();
  assert.deepEqual(turnTotals(messages), { model: "deepseek-chat", tier: "budget", tokens: 6600, costUsd: 0.004 });
  const finished = messages.map((message) => ({ ...message, streaming: false }));
  assert.deepEqual(turnFooter(finished), { durationMs: undefined, tools: 0, model: "deepseek-chat", tier: "budget", tokens: 6600, costUsd: 0.004 });
});

test("the cost of helper.ended is added to the turn's cost, with its tokens and a helper count", () => {
  let state = reduceChat(emptyChat, ev("model.call.started", { message_id: "m1", model: "deepseek-chat", tier: "budget" }));
  state = reduceChat(state, ev("message.started", { message_id: "m1" }));
  state = reduceChat(state, ev("model.call.completed", { message_id: "m1", usage: { input: 100, output: 10 }, cost_usd: 0.01 }));
  state = reduceChat(state, ev("tool.requested", { call_id: "d1", message_id: "m1", name: "delegate", args: { brief: "look" } }));
  state = reduceChat(
    state,
    ev("helper.ended", { call_id: "d1", index: 0, stopped: "done", model_calls: 2, tokens: 500, answer_tokens: 50, cost_usd: 0.25, duration_ms: 1000, working_ms: 900 }),
  );
  assert.deepEqual(turnTotals(state.messages), { model: "deepseek-chat", tier: "budget", tokens: 610, costUsd: 0.26, helpers: 1 });
});

test("a call still in flight adds no tokens", () => {
  let state = reduceChat(emptyChat, ev("model.call.started", { message_id: "m1", model: "qwen3:27b", tier: "local" }));
  state = reduceChat(state, ev("message.started", { message_id: "m1" }));
  assert.deepEqual(state.messages[0]?.call, { model: "qwen3:27b", tier: "local", tokens: null, costUsd: null, done: false });
  assert.deepEqual(turnTotals(state.messages), { model: "qwen3:27b", tier: "local", tokens: null, costUsd: null });
});

test("an old reply with no call has no totals", () => {
  const old: ChatMessage = { id: "a", role: "assistant", text: "hi", streaming: false };
  assert.deepEqual(turnTotals([old]), { model: null, tier: null, tokens: null, costUsd: null });
  assert.deepEqual(turnFooterParts(turnTotals([old])), []);
});

test("turnFooterParts shows the tier word for local only and leaves out what is unknown", () => {
  assert.deepEqual(turnFooterParts({ model: "qwen3:27b", tier: "local", tokens: 4100, costUsd: 0 }), ["qwen3:27b", "local", "4.1K tok", "$0.00"]);
  assert.deepEqual(turnFooterParts({ model: "deepseek-chat", tier: "budget", tokens: 900, costUsd: 0.31 }), ["deepseek-chat", "900 tok", "$0.31"]);
  assert.deepEqual(turnFooterParts({ model: null, tier: null, tokens: 4100, costUsd: null }), ["4.1K tok"]);
  assert.deepEqual(turnFooterParts({ model: "m", tier: null, tokens: null, costUsd: null }, "↑ "), ["↑ m"]);
});

test("the session's cost shows only once a call has cost something", () => {
  const paid = (costUsd: number | null): ChatMessage => ({
    id: "a",
    role: "assistant",
    text: "",
    streaming: false,
    call: { model: "m", tier: "budget", tokens: 10, costUsd, done: true },
  });
  assert.equal(sessionCostLabel([]), "");
  assert.equal(sessionCostLabel([paid(0)]), "");
  assert.equal(sessionCostLabel([paid(null)]), "");
  assert.equal(sessionCostLabel([paid(0.02), paid(0.01)]), "$0.03");
});

const NONE = { calls: 0, input: 0, output: 0, cost_usd: 0, saved_usd: 0 };

const FULL: CostGetResult = {
  session: { calls: 3, input: 38_200, output: 4_100, cost_usd: 0.03, saved_usd: 0 },
  today: { calls: 9, input: 212_000, output: 19_000, cost_usd: 0.42, saved_usd: 0 },
  week: { calls: 40, input: 1_400_000, output: 120_000, cost_usd: 2.1, saved_usd: 3.4 },
  saved_reference: "deepseek/deepseek-chat",
  by_model: [
    { provider: "ollama", model: "qwen3:27b", tier: "local", calls: 30, input: 1_000_000, output: 100_000, cost_usd: 0 },
    { provider: "deepseek", model: "deepseek-chat", tier: "budget", calls: 8, input: 240_000, output: 20_000, cost_usd: 0.19 },
    { provider: "anthropic", model: "claude-opus", tier: "frontier", calls: 2, input: 38_000, output: 3_000, cost_usd: 1.91 },
  ],
  by_day: [],
};

test("costReportLines: a full result, columns aligned with spaces", () => {
  assert.deepEqual(costReportLines(FULL), [
    "cost              in     out   cost",
    "this session   38.2K    4.1K  $0.03",
    "today         212.0K   19.0K  $0.42",
    "this week       1.4M  120.0K  $2.10",
    "",
    "by model (7 days)",
    "qwen3:27b      local       1.1M  $0.00",
    "deepseek-chat  budget    260.0K  $0.19",
    "claude-opus    frontier   41.0K  $1.91",
    "",
    "saved \u2248 $3.40 by running locally (against deepseek-chat prices)",
  ]);
});

test("costReportLines: a by job block when more than one role has rows", () => {
  const roles = [
    { role: "chat", calls: 30, input: 900_000, output: 90_000, cost_usd: 1.5 },
    { role: "explore", calls: 12, input: 300_000, output: 30_000, cost_usd: 0.6 },
  ];
  const lines = costReportLines({ ...FULL, by_role: roles });
  const at = lines.indexOf("by job (7 days)");
  assert.deepEqual(lines.slice(at, at + 3), [
    "by job (7 days)",
    "chat    990.0K  $1.50",
    "helper  330.0K  $0.60",
  ]);
  const one = costReportLines({ ...FULL, by_role: roles.slice(0, 1) });
  assert.equal(one.includes("by job (7 days)"), false);
});

test("costReportLines: no session row without a session, no saved line without a reference", () => {
  const lines = costReportLines({ ...FULL, session: null, saved_reference: null });
  assert.equal(lines.some((line) => line.startsWith("this session")), false);
  assert.equal(lines.some((line) => line.startsWith("saved")), false);
  assert.equal(lines[1]?.startsWith("today"), true);
});

test("costReportLines: zero everything is two rows and no model table", () => {
  assert.deepEqual(costReportLines({ today: NONE, week: NONE }), [
    "cost       in  out   cost",
    "today       0    0  $0.00",
    "this week   0    0  $0.00",
  ]);
});

test("costReportLines: an unknown model and tier are named", () => {
  const lines = costReportLines({
    today: NONE,
    week: NONE,
    by_model: [{ calls: 1, input: 5, output: 5, cost_usd: 0 }],
  });
  assert.equal(lines.at(-1), "unknown  -  10  $0.00");
});

test("turnFooterParts puts the routed note before the model", () => {
  const totals = { model: "deepseek-chat", tier: "budget", tokens: 1200, costUsd: 0.004 } as const;
  assert.deepEqual(turnFooterParts(totals, "", "\u2191 deepseek-chat \u00b7 did not fit in 32K"), [
    "\u2191 deepseek-chat \u00b7 did not fit in 32K",
    "deepseek-chat",
    "1.2K tok",
    "$0.004",
  ]);
  assert.deepEqual(turnFooterParts(totals), ["deepseek-chat", "1.2K tok", "$0.004"]);
});

test("helperCost reads the helper row of by_role (explore in an older daemon), and is null with no helper calls", () => {
  const totals = { input: 0, output: 0, calls: 0, cost_usd: 0, saved_usd: 0 };
  const result: CostGetResult = {
    today: totals,
    week: { ...totals, calls: 10, cost_usd: 2 },
    by_role: [
      { role: "chat", calls: 6, input: 100, output: 50, cost_usd: 1.5 },
      { role: "explore", calls: 4, input: 38_000, output: 200, cost_usd: 0.5 },
    ],
  };
  assert.deepEqual(helperCost(result), { calls: 4, tokens: "38.2K", cost: "$0.50", share: "25%", agents: [] });
  assert.equal(helperCost({ ...result, by_role: [result.by_role![0]!] }), null);
  assert.equal(helperCost({ ...result, by_role: undefined }), null);
  assert.equal(helperCost({ ...result, week: { ...totals, calls: 4 } })?.share, "");
});

const FREE = { input: 0, output: 0, calls: 0, cost_usd: 0, saved_usd: 0 };

test("helperCost has a row per agent type, the dearest first, with its share of the helpers", () => {
  const result: CostGetResult = {
    today: FREE,
    week: { ...FREE, calls: 10, cost_usd: 2 },
    by_role: [
      { role: "chat", calls: 6, input: 100, output: 50, cost_usd: 1.5 },
      { role: "helper", calls: 4, input: 38_000, output: 200, cost_usd: 0.5 },
    ],
    by_agent: [
      { agent: "explorer", calls: 3, input: 8000, output: 100, cost_usd: 0.1 },
      { agent: "reviewer", calls: 1, input: 30_000, output: 100, cost_usd: 0.4 },
    ],
  };
  assert.deepEqual(helperCost(result)?.agents, [
    { agent: "reviewer", calls: 1, tokens: "30.1K", cost: "$0.40", share: "80%" },
    { agent: "explorer", calls: 3, tokens: "8.1K", cost: "$0.10", share: "20%" },
  ]);
});

test("helperCost rows of local models have calls and tokens, a dash for cost and no share", () => {
  const result: CostGetResult = {
    today: FREE,
    week: { ...FREE, calls: 2 },
    by_role: [{ role: "helper", calls: 2, input: 300, output: 30, cost_usd: 0 }],
    by_agent: [{ agent: "explorer", calls: 2, input: 300, output: 30, cost_usd: 0 }],
  };
  assert.deepEqual(helperCost(result)?.agents, [{ agent: "explorer", calls: 2, tokens: "330", cost: "\u2014", share: "" }]);
});

test("helperCost from a daemon with no by_agent keeps the one total", () => {
  const result: CostGetResult = {
    today: FREE,
    week: { ...FREE, calls: 4, cost_usd: 1 },
    by_role: [{ role: "explore", calls: 4, input: 10, output: 10, cost_usd: 1 }],
  };
  assert.deepEqual(helperCost(result), { calls: 4, tokens: "20", cost: "$1.00", share: "100%", agents: [] });
});

test("costReportLines lists the helpers by type under the jobs, and not without by_agent", () => {
  const result: CostGetResult = {
    today: FREE,
    week: { ...FREE, calls: 4, cost_usd: 1 },
    by_role: [
      { role: "chat", calls: 1, input: 10, output: 10, cost_usd: 0.5 },
      { role: "helper", calls: 3, input: 10, output: 10, cost_usd: 0.5 },
    ],
    by_agent: [{ agent: "explorer", calls: 3, input: 10, output: 10, cost_usd: 0.5 }],
  };
  const lines = costReportLines(result);
  assert.ok(lines.includes("helpers by type (7 days)"));
  assert.match(lines.at(-1) ?? "", /^explorer\s+3 calls\s+20\s+\$0\.50\s+100%$/);
  assert.ok(!costReportLines({ ...result, by_agent: undefined }).includes("helpers by type (7 days)"));
});
