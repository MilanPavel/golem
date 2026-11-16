import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent, CostGetResult } from "@golem/client";

import { emptyChat, reduceChat, type ChatMessage } from "./chat-state.ts";
import { costReportLines, formatCost, sessionCostLabel, turnFooterParts, turnTotals } from "./cost.ts";
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
