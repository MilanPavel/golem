import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import {
  appendDelta,
  forkPoint,
  CANCELLED_NOTICE,
  SHUTDOWN_NOTICE,
  createDeltaBatcher,
  emptyChat,
  reduceChat,
} from "./chat-state.ts";

function event(partial: ChatEvent): ChatEvent {
  return partial;
}

test("reducer builds a turn from events", () => {
  let state = emptyChat;
  state = reduceChat(
    state,
    event({
      seq: 1,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.completed",
      data: { message_id: "u", role: "user", text: "hello" },
    }),
  );
  state = reduceChat(
    state,
    event({
      seq: 2,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "run.started",
      data: {},
    }),
  );
  state = reduceChat(
    state,
    event({
      seq: 3,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.started",
      data: { message_id: "a", role: "assistant" },
    }),
  );
  state = reduceChat(
    state,
    event({
      seq: 4,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.delta",
      data: { message_id: "a", text: "Hi" },
    }),
  );
  assert.equal(state.busy, true);
  assert.equal(state.runStartedAt, "t");
  assert.equal(state.messages[1]?.text, "Hi");
  assert.equal(state.messages[1]?.streaming, true);
  state = reduceChat(
    state,
    event({
      seq: 5,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.completed",
      data: { message_id: "a", role: "assistant", text: "Hi there" },
    }),
  );
  state = reduceChat(
    state,
    event({
      seq: 6,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "run.completed",
      data: {},
    }),
  );
  assert.equal(state.busy, false);
  assert.equal(state.runStartedAt, null);
  assert.equal(state.messages[0]?.text, "hello");
  assert.equal(state.messages[1]?.text, "Hi there");
  assert.equal(state.messages[1]?.streaming, false);
});

test("run.failed unlocks input and keeps the reason", () => {
  const started = reduceChat(emptyChat, {
    seq: 1,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.started",
    data: {},
  });
  const failed = reduceChat(started, {
    seq: 2,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.failed",
    data: { message: "model exploded" },
  });
  assert.equal(failed.busy, false);
  assert.equal(failed.runStartedAt, null);
  assert.equal(failed.error, "model exploded");
});

test("a replay of stored events rebuilds the transcript without deltas", () => {
  const stored: ChatEvent[] = [
    { seq: 2, session_id: "s", run_id: "r", ts: "t", type: "run.started", data: {} },
    {
      seq: 3,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.completed",
      data: { message_id: "m_u", role: "user", text: "hi" },
    },
    {
      seq: 4,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.started",
      data: { message_id: "m_a", role: "assistant" },
    },
    {
      seq: 7,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.completed",
      data: { message_id: "m_a", role: "assistant", text: "Hello" },
    },
    { seq: 8, session_id: "s", run_id: "r", ts: "t", type: "run.completed", data: {} },
  ];
  const state = stored.reduce(reduceChat, emptyChat);
  assert.deepEqual(
    state.messages.map((message) => [message.role, message.text, message.streaming]),
    [
      ["user", "hi", false],
      ["assistant", "Hello", false],
    ],
  );
  assert.equal(state.busy, false);
});

test("delta batcher flushes immediately and on the timer", async () => {
  const flushed: string[] = [];
  const batcher = createDeltaBatcher((messageId, text) => {
    flushed.push(`${messageId}:${text}`);
  });
  try {
    batcher.push("m", "H");
    batcher.push("m", "i");
    assert.deepEqual(flushed, []);
    batcher.flush();
    assert.deepEqual(flushed, ["m:Hi"]);
    batcher.push("m", "!");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(flushed, ["m:Hi", "m:!"]);
  } finally {
    batcher.stop();
  }
});

test("appendDelta only touches the matching bubble", () => {
  const state = appendDelta(
    {
      ...emptyChat,
      messages: [
        { id: "a", role: "assistant", text: "H", streaming: true },
        { id: "b", role: "assistant", text: "no", streaming: true },
      ],
    },
    "a",
    "i",
  );
  assert.equal(state.messages[0]?.text, "Hi");
  assert.equal(state.messages[1]?.text, "no");
});

test("run.cancelled ends the run and keeps the interrupted reply", () => {
  const stored: ChatEvent[] = [
    { seq: 1, session_id: "s", run_id: "r", ts: "t", type: "run.started", data: {} },
    {
      seq: 2,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.started",
      data: { message_id: "m_a", role: "assistant" },
    },
    {
      seq: 4,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.completed",
      data: { message_id: "m_a", role: "assistant", text: "Hel", interrupted: true },
    },
  ];
  const running = stored.reduce(reduceChat, emptyChat);
  assert.equal(running.runId, "r");
  const cancelled = reduceChat(running, {
    seq: 5,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.cancelled",
    data: { reason: "user" },
  });
  assert.equal(cancelled.busy, false);
  assert.equal(cancelled.runId, null);
  assert.equal(cancelled.notice, CANCELLED_NOTICE);
  assert.deepEqual(
    cancelled.messages.map((message) => [message.text, message.streaming, message.interrupted]),
    [["Hel", false, true]],
  );
  const stopped = reduceChat(running, {
    seq: 5,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.cancelled",
    data: { reason: "shutdown" },
  });
  assert.equal(stopped.notice, SHUTDOWN_NOTICE);
});

test("forkPoint is the newest finished message with something stored", () => {
  const message = (id: string, streaming: boolean, text = "x", interrupted = false) => ({
    id,
    role: "assistant" as const,
    text,
    streaming,
    interrupted,
  });
  assert.equal(forkPoint([]), null);
  assert.equal(forkPoint([message("m_1", false), message("m_2", true)]), "m_1");
  assert.equal(forkPoint([message("m_1", false), message("m_2", false, "", true)]), "m_1");
  assert.equal(forkPoint([message("m_1", false), message("m_2", false, "Hel", true)]), "m_2");
});
