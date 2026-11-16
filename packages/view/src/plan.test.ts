import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { reduceChat, emptyChat } from "./chat-state.ts";
import { applyComposer, closedDebug } from "./commands.ts";
import { emptyPlan, openPlan, planFooter, planOfCall, reducePlan } from "./plan.ts";

function ev(type: string, data: unknown, runId: string | null = null): ChatEvent {
  return { seq: 1, session_id: "s", run_id: runId, ts: "t", type, data } as unknown as ChatEvent;
}

const proposed = ev(
  "plan.proposed",
  {
    plan_id: "p1",
    call_id: "c1",
    title: "retry",
    steps: [
      { text: "Add with_retry", files: ["src/fetch.py"] },
      { text: "Add setting", files: ["src/config.py", "src/fetch.py"] },
      { text: "Test", files: [] },
    ],
  },
  "r1",
);

test("plan first follows session.created and session.plan.changed", () => {
  const on = reducePlan(emptyPlan, ev("session.plan.changed", { on: true }));
  assert.equal(on.on, true);
  assert.equal(reducePlan(on, ev("session.plan.changed", { on: false })).on, false);
  assert.equal(reducePlan(on, ev("session.created", { model_profile: "x" })).on, false);
});

test("a proposed plan waits until a later run starts", () => {
  const state = reducePlan(emptyPlan, proposed);
  assert.equal(state.plan?.title, "retry");
  assert.equal(state.plan?.callId, "c1");
  assert.equal(state.plan?.answered, false);
  assert.notEqual(openPlan(state), null);
  const answered = reducePlan(state, ev("run.started", {}, "r2"));
  assert.equal(answered.plan?.answered, true);
  assert.equal(openPlan(answered), null);
  assert.equal(reducePlan(emptyPlan, ev("run.started", {}, "r2")), emptyPlan);
});

test("the chat state carries the plan", () => {
  const state = reduceChat(emptyChat, proposed);
  assert.equal(state.plan.plan?.steps.length, 3);
});

test("the footer counts steps and distinct files", () => {
  const plan = reducePlan(emptyPlan, proposed).plan;
  assert.ok(plan);
  assert.equal(planFooter(plan), "3 steps · 2 files");
  assert.equal(planFooter({ steps: [{ text: "a", files: ["x"] }] }), "1 step · 1 file");
});

test("a call's arguments give the plan, or null when they are not whole", () => {
  assert.deepEqual(planOfCall({ title: "t", steps: [{ text: "a", files: ["f"] }, { text: "b" }] }), {
    title: "t",
    steps: [
      { text: "a", files: ["f"] },
      { text: "b", files: [] },
    ],
  });
  assert.equal(planOfCall({ title: "t" }), null);
  assert.equal(planOfCall({ title: "t", steps: [{ files: [] }] }), null);
});

test("/plan toggles, and /plan on and /plan off set it", () => {
  assert.deepEqual(applyComposer(closedDebug, "/plan"), { kind: "plan", on: "toggle" });
  assert.deepEqual(applyComposer(closedDebug, "/plan on"), { kind: "plan", on: true });
  assert.deepEqual(applyComposer(closedDebug, "/plan off"), { kind: "plan", on: false });
  assert.equal(applyComposer(closedDebug, "/plan maybe").kind, "unknown");
});
