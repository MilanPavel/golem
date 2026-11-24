import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { emptyChat, reduceChat, type ChatMessage, type ChatState, type ToolBlock } from "./chat-state.ts";
import { isLocalFrom, withLocal } from "./helper-card.ts";
import { batchAtOnce, batchCard, batchCounts, batchNumber, foldBatch, helperLimits, helperNumber, helperPanelState, helperRight, helperSummary, lastSentence, windowK } from "./helper-card.ts";

let seq = 0;
function ev(type: string, data: Record<string, unknown>): ChatEvent {
  seq += 1;
  return { seq, session_id: "lead", run_id: "r1", ts: `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}Z`, type, data } as unknown as ChatEvent;
}

function started(index: number, label: string, model: string, over: Record<string, unknown> = {}): ChatEvent {
  return ev("helper.started", {
    call_id: "d1",
    index,
    helper_id: `h${String(index)}`,
    agent: "explorer",
    label,
    model,
    wish: "cheapest",
    pick_reason: "the cheapest ready model",
    ...over,
  });
}

function stepEv(index: number, id: string, name: string, status: string, summary?: string): ChatEvent {
  return ev("helper.step", { call_id: "d1", index, step_id: id, name, args: { path: `${id}.py` }, status, calls: 1, ...(summary === undefined ? {} : { summary }) });
}

function ended(index: number, over: Record<string, unknown> = {}): ChatEvent {
  return ev("helper.ended", {
    call_id: "d1",
    index,
    stopped: "done",
    model_calls: 3,
    tokens: 14_000,
    answer_tokens: 620,
    cost_usd: 0,
    duration_ms: 72_000,
    working_ms: 70_000,
    ...over,
  });
}

const local = (): boolean => true;
const cloud = (): boolean => false;

/** Three helpers, one of each story: done, running and waiting for you. */
function story(model: string, cost: number): ChatEvent[] {
  return [
    started(0, "auth", model),
    started(1, "billing", model),
    started(2, "docs", model),
    stepEv(0, "a1", "read_file", "started"),
    stepEv(0, "a1", "read_file", "done", "40 lines"),
    stepEv(0, "a2", "grep", "done", "3 matches"),
    ev("helper.state", { call_id: "d1", index: 0, state: "running", reason: null }),
    ended(0, { cost_usd: cost }),
    ev("helper.state", { call_id: "d1", index: 1, state: "running", reason: null }),
    stepEv(1, "b1", "read_file", "started"),
    ev("helper.state", { call_id: "d1", index: 2, state: "waiting", reason: "you" }),
    ev("helper.wait", { call_id: "d1", state: "parked", helper_ids: ["h0", "h1", "h2"] }),
  ];
}

test("local only, Quiet: one line and no rows", () => {
  const card = batchCard(foldBatch("d1", story("qwen3:27b", 0), local), "quiet");
  assert.equal(card.head, "3 helpers · 1 running · 1 waiting · 1 done");
  assert.deepEqual(card.rows, []);
  assert.equal(card.total, null);
});

test("local only, Normal: what ran and the window saved, no cost", () => {
  const card = batchCard(foldBatch("d1", story("qwen3:27b", 0), local), "normal");
  assert.equal(card.rows.length, 3);
  const [auth, billing, docs] = card.rows;
  assert.equal(auth?.name, "auth");
  assert.equal(auth?.ran, "read 1 file, 1 search");
  assert.equal(auth?.number, "14K to 0.6K");
  assert.equal(auth?.right, "done");
  assert.equal(auth?.took, "1m 12s");
  assert.equal(billing?.right, "running");
  assert.equal(billing?.number, null);
  assert.equal(docs?.right, "waiting for your answer");
  assert.equal(docs?.model, "");
  assert.equal(card.total, "3 helpers · 1 running · 1 waiting · 1 done · 14K to 0.6K");
});

test("local only, Verbose: the model and why", () => {
  const card = batchCard(foldBatch("d1", story("qwen3:27b", 0), local), "verbose");
  assert.equal(card.rows[0]?.model, "qwen3:27b · the cheapest ready model");
  assert.equal(card.rows[0]?.number, "14K to 0.6K");
});

test("cloud only, Normal: cost first, then the window", () => {
  const card = batchCard(foldBatch("d1", story("claude-haiku", 0.04), cloud), "normal");
  assert.equal(card.rows[0]?.number, "$0.04 · 14K to 0.6K");
  assert.equal(card.total, "3 helpers · 1 running · 1 waiting · 1 done · $0.04 · 14K to 0.6K");
});

test("cloud only, Verbose and Quiet follow the level", () => {
  const verbose = batchCard(foldBatch("d1", story("claude-haiku", 0.04), cloud), "verbose");
  assert.equal(verbose.rows[0]?.model, "claude-haiku · the cheapest ready model");
  const quiet = batchCard(foldBatch("d1", story("claude-haiku", 0.04), cloud), "quiet");
  assert.deepEqual(quiet.rows, []);
});

test("a cost says cloud when nobody said, and no cost says local only when told", () => {
  assert.equal(helperNumber({ local: null, tokens: 14_000, answerTokens: 620, costUsd: 0.04 }), "$0.04 · 14K to 0.6K");
  const unknown = foldBatch("d1", [started(0, "a", "m"), ended(0, { cost_usd: 0.3 })]);
  assert.equal(unknown.helpers[0]?.local, false);
});

test("helper.model replaces the model and the reason that helper.started named, and an older log reads as before", () => {
  const moved = ev("helper.model", { call_id: "d1", index: 0, helper_id: "h0", model: "qwen3:27b", pick_reason: "you said no, so a local model" });
  const other = ev("helper.model", { call_id: "d2", index: 0, helper_id: "h0", model: "elsewhere", pick_reason: "x" });
  const isLocal = (model: string): boolean => model.startsWith("qwen");
  const batch = foldBatch("d1", [started(0, "a", "claude-opus"), moved, other, ended(0)], isLocal);
  const helper = batch.helpers[0];
  assert.equal(helper?.model, "qwen3:27b");
  assert.equal(helper?.pickReason, "you said no, so a local model");
  assert.equal(helper?.local, true);
  const older = foldBatch("d1", [started(0, "a", "claude-opus"), ended(0)], isLocal);
  assert.equal(older.helpers[0]?.model, "claude-opus");
  assert.equal(older.helpers[0]?.pickReason, "the cheapest ready model");
});

test("a mixed batch shows cost first", () => {
  const events = [started(0, "a", "qwen3:27b"), started(1, "b", "claude-haiku"), ended(0), ended(1, { cost_usd: 0.1 })];
  const batch = foldBatch("d1", events, (model) => model.startsWith("qwen"));
  assert.equal(batchNumber(batch.helpers), "$0.10 · 28K to 1.2K");
});

test("the right column is a state or a wait reason", () => {
  const base = { model: "qwen3:27b", stopped: null };
  assert.equal(helperRight({ ...base, state: "queued", reason: "slot" }), "waiting for qwen3:27b");
  assert.equal(helperRight({ ...base, state: "waiting", reason: "team" }), "waiting for the helpers");
  assert.equal(helperRight({ ...base, state: "waiting", reason: "you" }, "tui"), "waiting for you");
  assert.equal(helperRight({ ...base, state: "queued", reason: null }), "queued");
  assert.equal(helperRight({ ...base, state: "waiting", reason: "later" }), "waiting · later");
  assert.equal(helperRight({ ...base, state: "stopped", reason: null, stopped: "time" }), "stopped: time limit");
  assert.equal(helperRight({ ...base, state: "failed", reason: null }), "failed");
});

test("the head of the card says what the batch waits for, and the question wins", () => {
  const card = batchCard(foldBatch("d1", story("qwen3:27b", 0), local), "normal");
  assert.equal(card.right, "waiting for your answer");
  const running = batchCard(foldBatch("d1", [started(0, "a", "m"), stepEv(0, "s", "grep", "started")], local), "normal");
  assert.equal(running.right, "running");
  const parked = batchCard(foldBatch("d1", [started(0, "a", "m"), stepEv(0, "s", "grep", "started"), ev("helper.wait", { call_id: "d1", state: "parked", helper_ids: [] })]), "normal");
  assert.equal(parked.right, "waiting for the helpers");
});

test("a finished and a stopped batch", () => {
  const done = batchCard(foldBatch("d1", [started(0, "a", "m"), ended(0)], local), "normal");
  assert.equal(done.right, "done");
  assert.equal(done.tone, "ok");
  const stopped = batchCard(foldBatch("d1", [started(0, "a", "m"), ended(0, { stopped: "budget" })], local), "normal");
  assert.equal(stopped.rows[0]?.right, "stopped: budget spent");
  const failed = batchCard(foldBatch("d1", [started(0, "a", "m"), ended(0, { stopped: "failed" })], local), "normal");
  assert.equal(failed.right, "failed");
  assert.equal(failed.tone, "bad");
});

test("events of another call or type change nothing, and rows keep the call order", () => {
  const other = ev("helper.ended", { call_id: "other", index: 0, stopped: "done", model_calls: 1, tokens: 1, answer_tokens: 1, cost_usd: 0, duration_ms: 1, working_ms: 1 });
  const batch = foldBatch("d1", [started(1, "second", "m"), started(0, "first", "m"), other, ev("run.started", {})], local);
  assert.deepEqual(batch.helpers.map((helper) => helper.label), ["first", "second"]);
  assert.equal(batch.helpers[0]?.state, "queued");
});

test("an empty batch and a helper without a label", () => {
  assert.equal(batchCard(foldBatch("d1", []), "quiet").head, "starting helpers");
  const card = batchCard(foldBatch("d1", [started(0, "", "m")]), "normal");
  assert.equal(card.rows[0]?.name, "explorer");
});

test("window figures", () => {
  assert.deepEqual([620, 42, 1000, 5000, 14_000, 128_000].map(windowK), ["0.6K", "42", "1K", "5K", "14K", "128K"]);
});

function msg(over: Partial<ChatMessage> & Pick<ChatMessage, "role" | "text">): ChatMessage {
  return { id: `m${String(seq++)}`, streaming: false, ...over };
}

function tool(callId: string, name: string, status: ToolBlock["status"], extra: Partial<ToolBlock> = {}): ToolBlock {
  return { callId, name, args: {}, status, ...extra };
}

function helperChat(over: Partial<ChatState>, reply: Partial<ChatMessage> = {}): ChatState {
  const tools = [...Array.from({ length: 13 }, (_, at) => tool(`r${String(at)}`, "read_file", at === 4 ? "failed" : "done"))];
  return {
    ...emptyChat,
    messages: [
      msg({ role: "user", text: "Find where tokens are refreshed." }),
      msg({ role: "assistant", text: "I read the auth module. The refresh lives in auth/session.py.", tools, thinking: "hmm", ...reply }),
      msg({ role: "assistant", text: "Done. It is auth/session.py:88.", thinking: "ok" }),
    ],
    ...over,
  };
}

test("Summary while it runs: the newest sentence, no answer yet", () => {
  const cleared = reduceChat(emptyChat, ev("context.changed", { action: "cleared", count: 11, before_tokens: null, after_tokens: null }));
  const chat = helperChat({ busy: true, notices: cleared.notices });
  const summary = helperSummary(chat);
  assert.equal(summary.brief, "Find where tokens are refreshed.");
  assert.equal(summary.calls, "read 13 files, 1 failed");
  assert.equal(summary.latest, "It is auth/session.py:88.");
  assert.equal(summary.answer, null);
  assert.equal(summary.question, null);
  assert.equal(summary.hidden, "2 thoughts · 11 old results cleared");
});

test("Summary when done: the answer and no newest sentence", () => {
  const summary = helperSummary(helperChat({ busy: false }));
  assert.equal(summary.answer, "Done. It is auth/session.py:88.");
  assert.equal(summary.latest, null);
});

test("Summary when it asks: the question, no answer", () => {
  const approval = { callId: "c", name: "write_file", args: { path: "src/a.py" }, source: "x", diff: null };
  const summary = helperSummary(helperChat({ busy: true, approval }));
  assert.equal(summary.question, "wants to use write_file: src/a.py");
  assert.equal(summary.latest, null);
  assert.equal(summary.answer, null);
});

test("Summary of an empty helper has nothing to say", () => {
  assert.deepEqual(helperSummary(emptyChat), { brief: null, calls: null, latest: null, question: null, answer: null, hidden: null });
});

test("the last sentence", () => {
  assert.equal(lastSentence("One. Two three!  "), "Two three!");
  assert.equal(lastSentence("no mark"), "no mark");
  assert.equal(lastSentence("  "), null);
  assert.equal(lastSentence("see auth/session.py. Then src/a.py"), "Then src/a.py");
});

test("the limits line: calls and time from the helper's own log while it runs, the end's numbers after", () => {
  const ref = { startedAt: "2026-01-01T00:00:00Z", ended: null };
  const now = Date.parse("2026-01-01T00:01:11Z");
  const running = helperChat({ calls: { a: { model: "m", tier: null, tokens: null, costUsd: 0.01, done: true } } });
  assert.equal(helperLimits(ref, running, now), "1 call · 1m 11s · $0.01");
  assert.equal(helperLimits(ref, running, now, true), "1 call · 1m 11s");
  const end = { stopped: "done", modelCalls: 3, tokens: 14_000, answerTokens: 620, costUsd: 0.04, durationMs: 72_000, workingMs: 70_000 };
  assert.equal(helperLimits({ ...ref, ended: end }, running, now), "3 calls · 1m 10s · $0.04 · 14K to 0.6K");
  assert.equal(helperPanelState({ ended: end }, running), "done");
  assert.equal(helperPanelState({ ended: { ...end, stopped: "calls" } }, running), "stopped");
  assert.equal(helperPanelState({ ended: null }, helperChat({ busy: true })), "running");
});

test("reduceChat keeps a batch per delegate call, from the helper.* events and helper.wait", () => {
  const events = [
    ev("message.started", { message_id: "a", role: "assistant" }),
    ev("tool.requested", { call_id: "d1", message_id: "a", name: "delegate", args: { brief: "x" } }),
    started(0, "explorer", "m1"),
    ev("helper.wait", { call_id: "d1", state: "parked" }),
  ];
  const chat = events.reduce(reduceChat, emptyChat);
  assert.deepEqual(Object.keys(chat.batches), ["d1"]);
  assert.equal(chat.batches.d1?.helpers.length, 1);
  assert.equal(chat.batches.d1?.parked, true);
});

test("isLocalFrom reads the tier of the model list, and withLocal applies it", () => {
  const isLocal = isLocalFrom([{ ref: "ollama/qwen3:8b", tier: "local" }, { ref: "anthropic/haiku", tier: "budget" }]);
  assert.equal(isLocal("qwen3:8b"), true);
  assert.equal(isLocal("anthropic/haiku"), false);
  assert.equal(isLocal("nope"), null);
  const batch = withLocal(foldBatch("d1", [started(0, "a", "qwen3:8b")]), isLocal);
  assert.equal(batch.helpers[0]?.local, true);
});

function stateEv(index: number, state: string, over: Record<string, unknown> = {}): ChatEvent {
  return ev("helper.state", { call_id: "d1", index, state, ...over });
}

const LOCAL = "local:ollama:default:qwen3:14b";

test("a local-only batch says the place in line for each helper", () => {
  const events = [
    started(0, "a", "qwen3:14b"),
    started(1, "b", "qwen3:14b"),
    started(2, "c", "qwen3:14b"),
    stateEv(0, "running"),
    stateEv(1, "queued", { reason: "slot", line: LOCAL, position: 1, holder: "a" }),
    stateEv(2, "queued", { reason: "slot", line: LOCAL, position: 3 }),
  ];
  const batch = foldBatch("d1", events, () => true);
  assert.deepEqual(batchCounts(batch), { running: 1, total: 3 });
  assert.equal(batchAtOnce(batch), null);
  const card = batchCard(batch, "normal");
  assert.deepEqual(
    card.rows.map((row) => row.right),
    ["running", "next in line for qwen3:14b", "3rd in line for qwen3:14b"],
  );
  const tui = batchCard(batch, "normal", "tui");
  assert.deepEqual(
    tui.rows.map((row) => row.right),
    ["running", "next for qwen3:14b", "3rd for qwen3:14b"],
  );
});

test("two running helpers say how many run at once, and a wait is cleared when it runs", () => {
  const events = [
    started(0, "a", "qwen3:14b"),
    started(1, "b", "qwen3:14b"),
    stateEv(1, "queued", { reason: "slot", line: LOCAL, position: 1 }),
    stateEv(0, "running"),
    stateEv(1, "running"),
  ];
  const batch = foldBatch("d1", events);
  assert.equal(batchAtOnce(batch), "2 at once");
  assert.deepEqual(batchCounts(batch), { running: 2, total: 2 });
  assert.equal(batch.helpers[1]?.position, null);
  assert.equal(batch.helpers[1]?.line, null);
});

test("a cloud-only batch words the provider retry and the budget, with no local text", () => {
  const events = [
    started(0, "a", "claude-haiku"),
    started(1, "b", "claude-sonnet"),
    stateEv(0, "waiting", { reason: "provider", line: "provider:anthropic", retry_in_ms: 8000 }),
    stateEv(1, "waiting", { reason: "budget", spent_usd: 2, cap_usd: 2 }),
  ];
  const batch = foldBatch("d1", events, () => false);
  const web = batchCard(batch, "verbose").rows.map((row) => row.right);
  assert.deepEqual(web, ["anthropic is busy · trying again in 8 s", "budget spent: $2.00 of $2.00"]);
  const tui = batchCard(batch, "normal", "tui").rows.map((row) => row.right);
  assert.deepEqual(tui, ["anthropic is busy · again in 8 s", "spent $2.00 of $2.00"]);
  for (const text of [...web, ...tui]) assert.doesNotMatch(text, /local|qwen|line for|waiting for/);
  assert.equal(batchAtOnce(batch), null);
});

test("a budget wait without amounts keeps the plain words", () => {
  assert.equal(helperRight({ model: null, stopped: null, state: "waiting", reason: "budget" }), "the spend cap is reached · ask me, or go local");
});
