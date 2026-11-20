import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";
import { emptyChat, helperHead, helperTreeRows, reduceChat, type ToolBlock } from "@golem/view";

// The same helper story in both log shapes: a child run (events with `parent_call_id`, 9.7) and
// a child session (`helper.*` events, ADR-059). The tree must read the same for both.

const base = { session_id: "s", run_id: "r" } as const;

function delegateTurn(): ChatEvent[] {
  return [
    { ...base, ts: "2026-11-01T10:00:00.000Z", seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, ts: "2026-11-01T10:00:00.100Z", seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    {
      ...base,
      ts: "2026-11-01T10:00:01.000Z",
      seq: 3,
      type: "tool.requested",
      data: { call_id: "d1", message_id: "a", name: "delegate", args: { brief: "look d1" } },
    },
  ];
}

function oldRead(call: string, path: string, seq: number, finish: boolean): ChatEvent[] {
  const data = { parent_call_id: "d1" };
  const ts = `2026-11-01T10:00:0${String(seq % 10)}.000Z`;
  const opened: ChatEvent[] = [
    { ...base, ts, seq, type: "tool.requested", data: { call_id: call, message_id: "m", name: "read_file", args: { path }, ...data } },
    { ...base, ts, seq: seq + 1, type: "tool.started", data: { call_id: call, ...data } },
  ];
  const closed: ChatEvent = { ...base, ts, seq: seq + 2, type: "tool.completed", data: { call_id: call, summary: "3 lines", preview: "x", ...data } };
  return finish ? [...opened, closed] : opened;
}

function oldCall(seq: number, usage: { input: number; output: number }, cost: number): ChatEvent[] {
  const data = { parent_call_id: "d1" };
  return [
    {
      ...base,
      ts: "2026-11-01T10:00:02.000Z",
      seq,
      type: "model.call.started",
      data: { message_id: `m${String(seq)}`, index: 1, profile: "p", model: "qwen3:27b", tier: "local", ...data },
    },
    {
      ...base,
      ts: "2026-11-01T10:00:03.000Z",
      seq: seq + 1,
      type: "model.call.completed",
      data: { message_id: `m${String(seq)}`, latency_ms: 10, usage, cost_usd: cost, ...data },
    },
  ];
}

function newStep(seq: number, id: string, path: string, status: "running" | "done"): ChatEvent {
  return {
    ...base,
    ts: "2026-11-01T10:00:02.000Z",
    seq,
    type: "helper.step",
    data: { call_id: "d1", index: 0, step_id: id, name: "read_file", args: { path }, status, calls: 1, ...(status === "done" ? { summary: "3 lines" } : {}) },
  };
}

function newEvents(ended: boolean): ChatEvent[] {
  const ts = "2026-11-01T10:00:02.000Z";
  const events: ChatEvent[] = [
    {
      ...base,
      ts,
      seq: 10,
      type: "helper.started",
      data: { call_id: "d1", index: 0, helper_id: "h1", agent: "explorer", label: "explorer", model: "qwen3:27b", wish: "same", pick_reason: "" },
    },
    { ...base, ts, seq: 11, type: "helper.state", data: { call_id: "d1", index: 0, state: "running" } },
    newStep(12, "k1", "a.py", "running"),
    newStep(13, "k1", "a.py", "done"),
    newStep(14, "k2", "b.py", "running"),
  ];
  if (ended) {
    events.push(
      newStep(15, "k2", "b.py", "done"),
      {
        ...base,
        ts,
        seq: 16,
        type: "helper.ended",
        data: { call_id: "d1", index: 0, stopped: "done", model_calls: 2, tokens: 1040, answer_tokens: 620, cost_usd: 0.5, duration_ms: 71000, working_ms: 70000 },
      },
    );
  }
  return events;
}

const end: ChatEvent = {
  ...base,
  ts: "2026-11-01T10:01:13.000Z",
  seq: 40,
  type: "tool.completed",
  data: { call_id: "d1", summary: "explorer finished", preview: "found it", duration_ms: 71000 },
};

function delegateOf(events: ChatEvent[]): ToolBlock {
  const tool = events.reduce(reduceChat, emptyChat).messages[0]?.tools?.[0];
  assert.ok(tool);
  return tool;
}

// The one difference, and it is by design (ADR-059, "helper.step is thin on purpose"): a child
// session's cost reaches the lead's log only in `helper.ended`, so a running helper's head has
// no cost yet. A child run's head had it after its first model call.
test("a running helper has the same tree rows in both shapes, and its head lacks only the cost", () => {
  const old = delegateOf([...delegateTurn(), ...oldCall(10, { input: 100, output: 20 }, 0), ...oldRead("k1", "a.py", 12, true), ...oldRead("k2", "b.py", 15, false)]);
  const now = delegateOf([...delegateTurn(), ...newEvents(false)]);
  assert.equal(old.child?.status, "running");
  assert.equal(now.child?.status, "running");
  assert.equal(`${helperHead(now)} · $0.00`, helperHead(old));
  assert.deepEqual(helperTreeRows(now), helperTreeRows(old));
});

test("a finished helper has the same head and tree rows in the old and the new log shape", () => {
  const old = delegateOf([
    ...delegateTurn(),
    ...oldCall(10, { input: 100, output: 20 }, 0),
    ...oldRead("k1", "a.py", 12, true),
    ...oldRead("k2", "b.py", 15, true),
    ...oldCall(20, { input: 300, output: 620 }, 0.5),
    end,
  ]);
  const now = delegateOf([...delegateTurn(), ...newEvents(true), end]);
  assert.equal(old.child?.status, "done");
  assert.equal(now.child?.status, "done");
  assert.equal(helperHead(now), helperHead(old));
  assert.deepEqual(helperTreeRows(now), helperTreeRows(old));
  // A finished step has the same summary in both shapes.
  const summaries = (step: ToolBlock) => step.child?.toolSteps.map((s) => s.summary);
  assert.deepEqual(summaries(now), ["3 lines", "3 lines"]);
  assert.deepEqual(summaries(now), summaries(old));
});
