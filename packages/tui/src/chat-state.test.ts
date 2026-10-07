import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import {
  appendDelta,
  connectionLost,
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
  assert.equal(failed.error, "model exploded");
});

test("connectionLost clears a busy run", () => {
  const busy = { ...emptyChat, busy: true };
  assert.equal(connectionLost(busy).busy, false);
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
