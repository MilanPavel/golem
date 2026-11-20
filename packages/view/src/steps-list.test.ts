import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { emptyChat, reduceChat } from "./chat-state.ts";
import { batchSteps, helperSteps, layoutSteps } from "./steps-list.ts";

const T0 = Date.parse("2026-01-01T00:00:00Z");
let seq = 0;

/** An event `s` seconds after T0. */
function ev(s: number, type: string, data: Record<string, unknown>): ChatEvent {
  seq += 1;
  return { seq, session_id: "lead", run_id: "r1", ts: new Date(T0 + s * 1000).toISOString(), type, data } as unknown as ChatEvent;
}

const started = (s: number, index: number, model: string): ChatEvent =>
  ev(s, "helper.started", { call_id: "d1", index, helper_id: `h${String(index)}`, agent: "explorer", label: `h${String(index)}`, model, wish: "cheapest", pick_reason: "" });
const state = (s: number, index: number, st: string, reason?: string): ChatEvent =>
  ev(s, "helper.state", { call_id: "d1", index, state: st, ...(reason === undefined ? {} : { reason }) });
const ended = (s: number, index: number, durationMs: number, cost = 0): ChatEvent =>
  ev(s, "helper.ended", { call_id: "d1", index, stopped: "done", model_calls: 1, tokens: 1000, answer_tokens: 100, cost_usd: cost, duration_ms: durationMs, working_ms: durationMs });

const now = T0 + 100_000;

test("cloud only: a batch of five overlaps, five bars on one scale", () => {
  const events: ChatEvent[] = [];
  const spans: [number, number][] = [
    [0, 10],
    [0, 20],
    [2, 12],
    [5, 30],
    [8, 40],
  ];
  spans.forEach(([from], i) => {
    events.push(started(from, i, "anthropic:sonnet"), state(from, i, "running"));
  });
  spans.forEach(([from, to], i) => events.push(ended(to, i, (to - from) * 1000, 0.01)));
  const list = helperSteps("d1", events, now);
  assert.equal(list.rows.length, 5);
  assert.equal(list.originMs, T0);
  assert.equal(list.endMs, T0 + 40_000);
  assert.deepEqual(
    list.rows.map((r) => [r.from, r.to]),
    [
      [0, 0.25],
      [0, 0.5],
      [0.05, 0.3],
      [0.125, 0.75],
      [0.2, 1],
    ],
  );
  // They overlap: the fifth starts before the first ends.
  assert.ok((list.rows[4]?.from ?? 1) < (list.rows[0]?.to ?? 0));
  for (const row of list.rows) {
    assert.equal(row.segments.length, 1);
    assert.equal(row.segments[0]?.kind, "work");
    assert.equal(row.right, "done");
    assert.equal(row.running, false);
  }
  assert.equal(list.rows[0]?.took, "0m 10s");
});

test("local only: helpers take turns on one model, the later ones wait in line first", () => {
  const model = "local:ollama:srv:qwen3";
  const events: ChatEvent[] = [
    started(0, 0, model),
    started(0, 1, model),
    started(0, 2, model),
    state(0, 0, "running"),
    state(0, 1, "queued", "slot"),
    state(0, 2, "queued", "slot"),
    ended(10, 0, 10_000),
    state(10, 1, "running"),
    ended(20, 1, 20_000),
    state(20, 2, "running"),
    ended(30, 2, 30_000),
  ];
  const list = helperSteps("d1", events, now);
  assert.equal(list.spanMs, 30_000);
  const [a, b, c] = list.rows;
  assert.deepEqual(a?.segments, [{ kind: "work", from: 0, to: 1 / 3 }]);
  assert.deepEqual(
    b?.segments.map((s) => s.kind),
    ["line", "work"],
  );
  assert.deepEqual(
    c?.segments.map((s) => s.kind),
    ["line", "work"],
  );
  // Work does not overlap: each starts where the earlier ended.
  assert.equal(b?.segments[1]?.from, a?.to);
  assert.equal(c?.segments[1]?.from, b?.to);
  assert.equal(c?.segments[0]?.to, c?.segments[1]?.from);
});

test("waiting for you is its own segment, and a step takes a queued helper to work", () => {
  const events: ChatEvent[] = [
    started(0, 0, "anthropic:sonnet"),
    ev(2, "helper.step", { call_id: "d1", index: 0, step_id: "s1", name: "read_file", args: {}, status: "running", calls: 1 }),
    state(4, 0, "waiting", "you"),
    state(7, 0, "running"),
    ended(10, 0, 10_000),
  ];
  const [row] = helperSteps("d1", events, now).rows;
  assert.deepEqual(row?.segments, [
    { kind: "line", from: 0, to: 0.2 },
    { kind: "work", from: 0.2, to: 0.4 },
    { kind: "you", from: 0.4, to: 0.7 },
    { kind: "work", from: 0.7, to: 1 },
  ]);
});

test("a running row ends at now, which is passed in", () => {
  const events: ChatEvent[] = [started(0, 0, "m"), state(0, 0, "running"), started(5, 1, "m"), state(5, 1, "running"), ended(10, 0, 10_000)];
  const list = helperSteps("d1", events, T0 + 20_000);
  assert.equal(list.endMs, T0 + 20_000);
  const second = list.rows[1];
  assert.equal(second?.running, true);
  assert.equal(second?.to, 1);
  assert.equal(second?.took, "0m 15s");
  assert.equal(second?.right, "running");
  const later = helperSteps("d1", events, T0 + 40_000);
  assert.equal(later.rows[1]?.took, "0m 35s");
});

test("the lead row comes first and spans the batch", () => {
  const events: ChatEvent[] = [started(1, 0, "m"), state(1, 0, "running"), ended(9, 0, 8000)];
  const list = helperSteps("d1", events, now, { lead: { label: "lead", startedAt: new Date(T0).toISOString() } });
  assert.deepEqual(
    list.rows.map((r) => r.role),
    ["lead", "helper"],
  );
  assert.equal(list.rows[0]?.from, 0);
  assert.equal(list.rows[0]?.to, 1);
  assert.equal(list.rows[0]?.right, "done");
});

test("no helper events of this call give an empty list; other calls are ignored", () => {
  assert.equal(helperSteps("zz", [started(0, 0, "m")], now).rows.length, 0);
});

test("layoutSteps takes spans of any source, such as workflow runs", () => {
  const list = layoutSteps(
    [
      { id: "b", label: "build", role: "helper", startMs: 50, endMs: 100, marks: [], right: "done", tone: "ok" },
      { id: "a", label: "fetch", role: "helper", startMs: 0, endMs: 50, marks: [{ atMs: 25, kind: "line" }], right: "done", tone: "ok" },
    ],
    1000,
  );
  assert.deepEqual(
    list.rows.map((r) => r.id),
    ["a", "b"],
  );
  assert.deepEqual(list.rows[0]?.segments, [
    { kind: "work", from: 0, to: 0.25 },
    { kind: "line", from: 0.25, to: 0.5 },
  ]);
  assert.equal(list.spanMs, 100);
});

test("the reduced chat keeps the timing: batchSteps over reduceChat equals helperSteps over the log", () => {
  const events: ChatEvent[] = [
    ev(0, "message.started", { message_id: "m", role: "assistant" }),
    ev(0, "message.completed", { message_id: "m", role: "assistant", text: "go" }),
    ev(0, "tool.requested", { call_id: "d1", message_id: "m", name: "delegate", args: {} }),
    started(0, 0, "ollama/q"),
    state(0, 0, "running"),
    started(0, 1, "ollama/q"),
    state(0, 1, "queued", "slot"),
    ended(20, 0, 20_000),
    state(20, 1, "running"),
  ];
  const chat = events.reduce(reduceChat, emptyChat);
  const batch = chat.batches.d1;
  assert.ok(batch !== undefined);
  const fromState = batchSteps(batch, chat.batchTimes.d1 ?? {}, now);
  assert.deepEqual(fromState, helperSteps("d1", events, now));
  assert.deepEqual(
    fromState.rows[1]?.segments.map((s) => s.kind),
    ["line", "work"],
  );
});
