import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { emptyChat, reduceChat, type ChatMessage } from "./chat-state.ts";
import { formatCost, sessionCostLabel, turnFooterParts, turnTotals } from "./cost.ts";
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
