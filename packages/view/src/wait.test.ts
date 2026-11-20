import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { emptyChat, reduceChat } from "./chat-state.ts";
import { lineName, ordinal, waitText, waitWords, WAITING_FOR_LOCAL_MODEL, type WaitState } from "./wait.ts";

const base: WaitState = {
  reason: "slot",
  line: "local:ollama:http://127.0.0.1:11434:qwen3:14b",
  model: null,
  position: null,
  holder: null,
  retryInMs: null,
  silentMs: null,
  scope: null,
  willRetry: null,
};
const wait = (over: Partial<WaitState>): WaitState => ({ ...base, ...over });

test("slot: the model's own name, the place in line and who is ahead", () => {
  const w = wait({ position: 2, holder: "Refactor auth" });
  assert.equal(waitWords(w, "web"), "waiting for qwen3:14b · 2nd in line, behind Refactor auth");
  assert.equal(waitWords(w, "tui"), "waiting for qwen3:14b · 2nd · behind Refactor auth");
});

test("load: says which model loads", () => {
  const w = wait({ reason: "load", line: "qwen3:4b" });
  assert.equal(waitWords(w, "web"), "loading qwen3:4b");
  assert.equal(waitWords(w, "tui"), "loading qwen3:4b");
});

test("provider: the provider's name and the time left", () => {
  const w = wait({ reason: "provider", line: "provider:anthropic", retryInMs: 8000 });
  assert.equal(waitWords(w, "web"), "anthropic is busy · trying again in 8 s");
  assert.equal(waitWords(w, "tui"), "anthropic is busy · again in 8 s");
  assert.equal(waitWords(wait({ reason: "provider", line: "anthropic", position: 3 }), "web"), "anthropic is busy · 3rd in line");
});

test("team: a lead waits for its helpers", () => {
  const w = wait({ reason: "team", line: null });
  assert.equal(waitWords(w, "web"), "waiting for the helpers");
  assert.equal(waitWords(w, "tui"), "waiting for helpers");
});

test("budget: the spend cap asks", () => {
  const w = wait({ reason: "budget", line: null });
  assert.equal(waitWords(w, "web"), "the spend cap is reached · ask me, or go local");
  assert.equal(waitWords(w, "tui"), "spend cap reached · ask me, or go local");
});

test("you: the run waits for the person", () => {
  const w = wait({ reason: "you", line: null });
  assert.equal(waitWords(w, "web"), "waiting for your answer");
  assert.equal(waitWords(w, "tui"), "waiting for you");
});

test("stalled: how long, and whether a retry follows", () => {
  const w = wait({ reason: "stalled", line: "qwen3:14b", silentMs: 45_000, scope: "call", willRetry: true });
  assert.equal(waitWords(w, "web"), "no answer from qwen3:14b for 45 s · retrying once");
  assert.equal(waitWords(w, "tui"), "no answer from qwen3:14b for 45 s · retrying once");
  assert.equal(waitWords({ ...w, willRetry: false }, "web"), "no answer from qwen3:14b for 45 s · stopped");
  assert.equal(
    waitWords(wait({ reason: "stalled", scope: "team", silentMs: 120_000 }), "web"),
    "nothing has moved in this team for 2 min · Stop or Retry",
  );
});

test("ordinals", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "111th"]);
  assert.equal(waitWords(wait({ position: 11 }), "web"), "waiting for qwen3:14b · 11th in line");
});

test("a missing holder or position leaves that part out", () => {
  assert.equal(waitWords(wait({ position: 1 }), "web"), "waiting for qwen3:14b · 1st in line");
  assert.equal(waitWords(wait({ position: 1 }), "tui"), "waiting for qwen3:14b · 1st");
  assert.equal(waitWords(wait({ holder: "Refactor auth" }), "web"), "waiting for qwen3:14b · behind Refactor auth");
  assert.equal(waitWords(wait({}), "tui"), "waiting for qwen3:14b");
});

test("a malformed line falls back to the model, then to a plain noun", () => {
  for (const line of ["local:ollama", "local:", "provider:", "", "   "]) {
    assert.equal(lineName(line), null, line);
    assert.equal(waitWords(wait({ line }), "web"), "waiting for the model");
    assert.equal(waitWords(wait({ line, model: "qwen3:8b" }), "web"), "waiting for qwen3:8b");
  }
  assert.equal(waitWords(wait({ line: null }), "web"), "waiting for the model");
  assert.equal(waitWords(wait({ line: "shell", position: 2 }), "web"), "waiting for the shell · 2nd in line");
});

test("lines of every shape give a name", () => {
  assert.equal(lineName("local:ollama:http://127.0.0.1:11434:qwen3:14b"), "qwen3:14b");
  assert.equal(lineName("local:ollama:localhost:qwen3:14b"), "qwen3:14b");
  assert.equal(lineName("provider:anthropic"), "anthropic");
  assert.equal(lineName("qwen3:14b"), "qwen3:14b");
  assert.equal(lineName("anthropic"), "anthropic");
});

test("without a reason (an older daemon) the words stay as they were", () => {
  assert.equal(waitText(null, "web"), "waiting for the local model");
  assert.equal(waitText(null, "tui"), "waiting for the local model");
  assert.equal(WAITING_FOR_LOCAL_MODEL, "waiting for the local model");
});

test("a hosted-provider wait never says local model, for any reason", () => {
  for (const reason of ["slot", "load", "provider", "team", "budget", "you", "stalled"] as const) {
    for (const line of ["provider:anthropic", "anthropic", null]) {
      const w = wait({ reason, line, position: 2, holder: "Refactor auth", retryInMs: 8000, silentMs: 90_000, willRetry: true });
      for (const length of ["web", "tui"] as const) {
        assert.doesNotMatch(waitWords(w, length), /local model/i, `${reason} ${line} ${length}`);
      }
    }
  }
});

const ev = (seq: number, data: Record<string, unknown>): ChatEvent =>
  ({ session_id: "s", run_id: "r", ts: "t", seq, type: "model.waiting", data: { message_id: "a", ...data } }) as ChatEvent;

test("the reducer keeps the fields of model.waiting, and clears them when the wait ends", () => {
  const on = reduceChat(
    emptyChat,
    ev(1, {
      waiting: true,
      reason: "slot",
      line: "local:ollama:http://127.0.0.1:11434:qwen3:14b",
      position: 2,
      holder: "Refactor auth",
      retry_in_ms: null,
      silent_ms: 45_000,
      scope: "call",
      will_retry: true,
    }),
  );
  assert.equal(on.localWait, true);
  assert.deepEqual(on.wait, {
    reason: "slot",
    line: "local:ollama:http://127.0.0.1:11434:qwen3:14b",
    model: null,
    position: 2,
    holder: "Refactor auth",
    retryInMs: null,
    silentMs: 45_000,
    scope: "call",
    willRetry: true,
  });
  assert.equal(waitText(on.wait, "tui"), "waiting for qwen3:14b · 2nd · behind Refactor auth");
  const moved = reduceChat(on, ev(2, { waiting: true, reason: "slot", line: on.wait?.line, position: 1, holder: "Refactor auth" }));
  assert.equal(moved.wait?.position, 1);
  assert.equal(reduceChat(on, ev(3, { waiting: false })).wait, null);
  assert.equal(reduceChat(on, ev(3, { waiting: true, reason: "slot", line: on.wait?.line, position: 2, holder: "Refactor auth", silent_ms: 45_000, scope: "call", will_retry: true })), on);
  assert.equal(emptyChat.wait, null);
});

test("an event without a reason leaves wait null, so the old words show", () => {
  const on = reduceChat(emptyChat, ev(1, { waiting: true }));
  assert.equal(on.localWait, true);
  assert.equal(on.wait, null);
  assert.equal(waitText(on.wait, "web"), "waiting for the local model");
});
