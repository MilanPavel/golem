import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent, ModelOptionsGetResult } from "@golem/client";

import type { ChatMessage } from "./chat-state.ts";
import { foldTry, planTry, startedTry, tryAnswer, tryHeading, tryTitle } from "./try-again.ts";
import { tuneState } from "./tune.ts";

const RESULT: ModelOptionsGetResult = {
  model: "qwen3:8b",
  options: [
    { name: "temperature", label: "temperature", kind: "float", minimum: 0, maximum: 2, step: 0.05, default: 0.8, short: "s", long: "l" },
    { name: "top_p", label: "top_p", kind: "float", minimum: 0, maximum: 1, step: 0.01, default: 0.9, short: "s", long: "l" },
  ],
  defaults: { temperature: 0.7, top_p: 0.9 },
  saved: { temperature: 0.2 },
  session: { top_p: 0.5 },
};

function message(id: string, role: "user" | "assistant", text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, text, streaming: false, ...extra };
}

const tune = tuneState(RESULT);

test("the plan forks before the last question and resends it with the merged options", () => {
  const plan = planTry(
    {
      busy: false,
      messages: [
        message("m1", "user", "hi"),
        message("m2", "assistant", "hello"),
        message("m3", "user", "write a haiku"),
        message("m4", "assistant", "Old pond\nA frog jumps in"),
      ],
    },
    tune,
  );
  assert.deepEqual(plan, {
    kind: "try",
    forkAt: "m2",
    options: { temperature: 0.2, top_p: 0.5 },
    text: "write a haiku",
    original: "Old pond",
  });
});

test("the first question has no fork point", () => {
  const plan = planTry({ busy: false, messages: [message("m1", "user", "hi"), message("m2", "assistant", "yo")] }, tune);
  assert.equal(plan.kind === "try" && plan.forkAt, null);
});

test("no question and a running chat are refused with a reason", () => {
  assert.deepEqual(planTry({ busy: false, messages: [] }, tune), {
    kind: "refused",
    reason: "no-question",
    notice: "Ask something first, then try again.",
  });
  assert.deepEqual(planTry({ busy: true, messages: [message("m1", "user", "hi")] }, tune), {
    kind: "refused",
    reason: "running",
    notice: "Wait for the answer, then try again.",
  });
  assert.equal(
    planTry({ busy: false, messages: [message("m1", "user", "hi"), message("m2", "assistant", "y", { streaming: true })] }, tune).kind,
    "refused",
  );
});

test("the heading lists the values that differ from the model's defaults", () => {
  assert.equal(tryHeading(tune), "try · temperature 0.2 · top_p 0.5");
  assert.equal(tryHeading(tuneState({ ...RESULT, saved: {}, session: {} })), "try · model defaults");
});

test("the title is try · the session's title, else the question", () => {
  assert.equal(tryTitle("Fix the build", "q"), "try · Fix the build");
  assert.equal(tryTitle(null, "write a\nhaiku"), "try · write a");
});

function event(type: string, data: object, session_id = "f1"): ChatEvent {
  return { session_id, run_id: "r1", seq: 1, ts: "2026-11-09T10:00:00Z", type, data } as unknown as ChatEvent;
}

test("the answer is the reply after the question, and only once the run started", () => {
  const plan = planTry({ busy: false, messages: [message("m1", "user", "hi")] }, tune);
  assert.equal(plan.kind, "try");
  if (plan.kind !== "try") return;
  let run = startedTry("f1", plan, "try · x");
  const done = (id: string, role: string, text: string) =>
    event("message.completed", { message_id: id, role, text, tool_calls: [] });
  run = foldTry(run, done("h1", "user", "hi"));
  run = foldTry(run, done("h2", "assistant", "old answer"));
  assert.equal(tryAnswer(run), null);
  run = foldTry(run, event("run.started", {}));
  run = foldTry(run, done("n1", "user", "hi"));
  assert.deepEqual(tryAnswer(run), { text: "", streaming: true, error: null });
  run = foldTry(run, done("n2", "assistant", "new answer"));
  run = foldTry(run, event("run.completed", {}));
  assert.deepEqual(tryAnswer(run), { text: "new answer", streaming: false, error: null });
  assert.equal(foldTry(run, event("run.started", {}, "other")), run);
});
