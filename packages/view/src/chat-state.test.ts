import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import {
  appendDelta,
  forkPoint,
  noticesAfter,
  downloadEnded,
  SHUTDOWN_NOTICE,
  skippedNotice,
  unreadCallNotice,
  createDeltaBatcher,
  emptyChat,
  failureText,
  providersUp,
  reduceChat,
  serverUp,
  stopWriting,
  thinkingLine,
} from "./chat-state.ts";
import { helperLine } from "./helper.ts";

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
  assert.equal(failed.down, null);
});

test("a model server that did not answer says how to fix it, until a run completes", () => {
  const down = reduceChat(emptyChat, {
    seq: 2,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.failed",
    data: {
      message: "Ollama is not running",
      code: "model_unreachable",
      provider: "ollama",
      hint: "run ollama serve",
    },
  });
  assert.equal(down.error, "Ollama is not running · run ollama serve · /model to switch");
  assert.equal(down.down, "ollama");

  const other = reduceChat(down, {
    seq: 3,
    session_id: "s",
    run_id: "r2",
    ts: "t",
    type: "run.failed",
    data: { message: "model exploded" },
  });
  assert.equal(other.error, "model exploded");
  assert.equal(other.down, "ollama");

  const completed = reduceChat(other, {
    seq: 4,
    session_id: "s",
    run_id: "r3",
    ts: "t",
    type: "run.completed",
    data: {},
  });
  assert.equal(completed.down, null);
});

test("a spent budget says what to do and marks no server down", () => {
  const spent = reduceChat(emptyChat, {
    seq: 2,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.failed",
    data: {
      message: "the daily budget is spent",
      code: "budget_spent",
      hint: "raise it in Settings › Routing, or switch the model",
    },
  });
  assert.equal(spent.error, "the daily budget is spent · raise it in Settings › Routing, or switch the model");
  assert.equal(spent.down, null);
});

test("a server that answers again is no longer marked down", () => {
  const down = { ...emptyChat, down: "ollama" };
  assert.equal(serverUp(down, "ollama").down, null);
  assert.equal(serverUp(down, "lmstudio"), down);
  assert.equal(serverUp(emptyChat, "ollama"), emptyChat);
});

test("a server that answers again takes back the question about installing it", () => {
  const asking = { ...emptyChat, down: "ollama", retry: { text: "hi", provider: "ollama" } };
  const up = serverUp(asking, "ollama");
  assert.equal(up.down, null);
  assert.equal(up.retry, null);
  assert.equal(serverUp(asking, "lmstudio"), asking);
});

test("a listing that calls a provider ready marks it up", () => {
  const asking = { ...emptyChat, down: "ollama", retry: { text: "hi", provider: "ollama" } };
  const listed = providersUp(asking, [
    { provider: "openai", status: "ready" },
    { provider: "ollama", status: "ready" },
  ]);
  assert.equal(listed.down, null);
  assert.equal(listed.retry, null);
  assert.equal(providersUp(asking, [{ provider: "ollama", status: "not_installed" }]), asking);
});

test("choosing a model clears the server that was down", () => {
  const down = { ...emptyChat, down: "ollama" };
  const switched = reduceChat(down, {
    seq: 5,
    session_id: "s",
    run_id: null,
    ts: "t",
    type: "model.selected",
    data: { model_profile: "anthropic/claude-sonnet-5-5", reason: "user" },
  });
  assert.equal(switched.down, null);
});

test("a failure without a code shows the hint and no /model", () => {
  assert.equal(
    failureText({ message: "Ollama is not answering", hint: "check that it is running" }),
    "Ollama is not answering · check that it is running",
  );
  assert.equal(
    failureText({ message: "the model's server did not answer", code: "model_unreachable" }),
    "the model's server did not answer · /model to switch",
  );
});

test("a rate limit, no credit and a refused key show their hint and /model", () => {
  const hints = [
    ["rate_limited", "deepseek is rate-limited", "wait a minute and try again"],
    ["no_credit", "deepseek has no credit left", "add credit at deepseek"],
    ["auth_failed", "deepseek did not accept the key", "/login deepseek"],
  ] as const;
  for (const [code, message, hint] of hints) {
    assert.equal(failureText({ message, code, hint }), `${message} · ${hint} · /model to switch`);
  }
});

test("an Ollama that is not installed marks the model down and offers /model to install it", () => {
  const missing = reduceChat(emptyChat, {
    seq: 2,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.failed",
    data: {
      message: "Ollama is not installed",
      code: "not_installed",
      provider: "ollama",
      hint: "run brew install ollama",
    },
  });
  assert.equal(missing.error, "Ollama is not installed · /model to install it or switch");
  assert.equal(missing.down, "ollama");
});

test("a message a missing Ollama stopped waits to be sent again, until the next run or model", () => {
  const notInstalled: ChatEvent = {
    seq: 4,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.failed",
    data: { message: "Ollama is not installed", code: "not_installed", provider: "ollama" },
  };
  const sent = [
    { seq: 1, session_id: "s", run_id: "r", ts: "t", type: "message.completed", data: { message_id: "u1", role: "user", text: "first" } },
    { seq: 2, session_id: "s", run_id: "r", ts: "t", type: "message.completed", data: { message_id: "u2", role: "user", text: "hello" } },
    { seq: 3, session_id: "s", run_id: "r", ts: "t", type: "run.started", data: {} },
  ] satisfies ChatEvent[];
  const failed = [...sent, notInstalled].reduce(reduceChat, emptyChat);
  assert.deepEqual(failed.retry, { text: "hello", provider: "ollama" });

  const again = reduceChat(failed, { seq: 5, session_id: "s", run_id: "r2", ts: "t", type: "run.started", data: {} });
  assert.equal(again.retry, null);
  const switched = reduceChat(failed, {
    seq: 5,
    session_id: "s",
    run_id: null,
    ts: "t",
    type: "model.selected",
    data: { model_profile: "anthropic/claude-sonnet-5-5", reason: "user" },
  });
  assert.equal(switched.retry, null);
});

test("only a missing Ollama offers to send again", () => {
  const withMessage = reduceChat(emptyChat, {
    seq: 1,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "message.completed",
    data: { message_id: "u1", role: "user", text: "hello" },
  });
  const stopped = reduceChat(withMessage, {
    seq: 2,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.failed",
    data: { message: "Ollama is not running", code: "model_unreachable", provider: "ollama" },
  });
  assert.equal(stopped.retry, null);
  const nothingSent = reduceChat(emptyChat, {
    seq: 2,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.failed",
    data: { message: "Ollama is not installed", code: "not_installed", provider: "ollama" },
  });
  assert.equal(nothingSent.retry, null);
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
  // The TUI shows a cancel you asked for as a hint, so the banner keeps what it had.
  assert.equal(cancelled.notice, null);
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

test("a finished answer keeps the event time and how long the run took", () => {
  const started = "2026-10-17T18:00:00.000Z";
  const finished = "2026-10-17T18:00:12.400Z";
  const state = [
    {
      seq: 1,
      session_id: "s",
      run_id: "r",
      ts: started,
      type: "message.completed" as const,
      data: { message_id: "u", role: "user" as const, text: "hello" },
    },
    { seq: 2, session_id: "s", run_id: "r", ts: started, type: "run.started" as const, data: {} },
    {
      seq: 3,
      session_id: "s",
      run_id: "r",
      ts: started,
      type: "message.started" as const,
      data: { message_id: "a", role: "assistant" as const },
    },
    {
      seq: 4,
      session_id: "s",
      run_id: "r",
      ts: finished,
      type: "message.completed" as const,
      data: { message_id: "a", role: "assistant" as const, text: "Hi" },
    },
  ].reduce(reduceChat, emptyChat);
  assert.equal(state.messages[0]?.at, started);
  assert.equal(state.messages[0]?.durationMs, undefined);
  assert.equal(state.messages[1]?.at, finished);
  assert.equal(state.messages[1]?.durationMs, 12_400);
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

test("tool events draw blocks under the reply that asked", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const events: ChatEvent[] = [
    { ...base, seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    {
      ...base,
      seq: 3,
      type: "tool.requested",
      data: { call_id: "c1", message_id: "a", name: "read_file", args: { path: "a.ts" } },
    },
    {
      ...base,
      seq: 4,
      type: "tool.requested",
      data: { call_id: "c2", message_id: "a", name: "read_file", args: { path: "/etc/hosts" } },
    },
    { ...base, seq: 5, type: "tool.started", data: { call_id: "c1" } },
    {
      ...base,
      seq: 6,
      type: "tool.completed",
      data: { call_id: "c1", summary: "2 lines", preview: "x", truncated: false },
    },
    { ...base, seq: 7, type: "tool.failed", data: { call_id: "c2", message: "outside" } },
    { ...base, seq: 8, type: "tool.started", data: { call_id: "unknown" } },
  ];
  const state = events.reduce(reduceChat, emptyChat);
  const tools = state.messages[0]?.tools ?? [];
  assert.deepEqual(
    tools.map((tool) => [tool.callId, tool.status, tool.summary ?? tool.error]),
    [
      ["c1", "done", "2 lines"],
      ["c2", "failed", "outside"],
    ],
  );
  assert.equal(tools[0]?.unsuccessful, undefined);
});

test("a finished data query keeps its table, the withheld flag and how long it ran", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const table = { result_id: "r_1", source: "bank", columns: [{ name: "n", type: "BIGINT" }], rows: [[1], [2]], total_rows: 2, truncated: false };
  const events: ChatEvent[] = [
    { ...base, seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    { ...base, seq: 3, type: "tool.requested", data: { call_id: "q", message_id: "a", name: "data_query", args: { source: "bank" } } },
    { ...base, seq: 4, type: "tool.started", data: { call_id: "q" } },
    {
      ...base,
      seq: 5,
      type: "tool.completed",
      data: { call_id: "q", summary: "2 rows", preview: "2 rows", rows_withheld: true, duration_ms: 38, table },
    },
  ];
  const tool = events.reduce(reduceChat, emptyChat).messages[0]?.tools?.[0];
  assert.deepEqual(tool?.table, table);
  assert.equal(tool?.rowsWithheld, true);
  assert.equal(tool?.durationMs, 38);
});

test("a call that ran but failed is done and unsuccessful", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const events: ChatEvent[] = [
    { ...base, seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    {
      ...base,
      seq: 3,
      type: "tool.requested",
      data: { call_id: "c1", message_id: "a", name: "shell", args: { command: "false" } },
    },
    {
      ...base,
      seq: 4,
      type: "tool.completed",
      data: { call_id: "c1", summary: "exit 1", preview: "[exit code 1]", failed: true },
    },
  ];
  const tool = events.reduce(reduceChat, emptyChat).messages[0]?.tools?.[0];
  assert.deepEqual([tool?.status, tool?.summary, tool?.unsuccessful], ["done", "exit 1", true]);
});

const helperBase = { session_id: "s", run_id: "r" } as const;

function delegateTurn(...ids: string[]): ChatEvent[] {
  const head: ChatEvent[] = [
    { ...helperBase, ts: "2026-11-01T10:00:00.000Z", seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...helperBase, ts: "2026-11-01T10:00:00.100Z", seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
  ];
  return [
    ...head,
    ...ids.map(
      (id, at): ChatEvent => ({
        ...helperBase,
        ts: "2026-11-01T10:00:01.000Z",
        seq: 3 + at,
        type: "tool.requested",
        data: { call_id: id, message_id: "a", name: "delegate", args: { brief: `look ${id}` } },
      }),
    ),
  ];
}

function childRead(id: string, call: string, path: string, seq: number, finish = true): ChatEvent[] {
  const data = { parent_call_id: id };
  const at = `2026-11-01T10:00:0${String(seq % 10)}.000Z`;
  const opened: ChatEvent[] = [
    { ...helperBase, ts: at, seq, type: "tool.requested", data: { call_id: call, message_id: "m", name: "read_file", args: { path }, ...data } },
    { ...helperBase, ts: at, seq: seq + 1, type: "tool.started", data: { call_id: call, ...data } },
  ];
  const closed: ChatEvent[] = [
    { ...helperBase, ts: at, seq: seq + 2, type: "tool.completed", data: { call_id: call, summary: "3 lines", preview: "x", ...data } },
  ];
  return finish ? [...opened, ...closed] : opened;
}

function childCall(id: string, seq: number, usage: { input: number; output: number }, cost: number): ChatEvent[] {
  const data = { parent_call_id: id };
  return [
    {
      ...helperBase,
      ts: "2026-11-01T10:00:02.000Z",
      seq,
      type: "model.call.started",
      data: { message_id: `m${String(seq)}`, index: 1, profile: "p", model: "qwen3:27b", tier: "local", ...data },
    },
    {
      ...helperBase,
      ts: "2026-11-01T10:00:03.000Z",
      seq: seq + 1,
      type: "model.call.completed",
      data: { message_id: `m${String(seq)}`, latency_ms: 10, usage, cost_usd: cost, ...data },
    },
  ];
}

test("events of a child run fold into the delegate step, in order, and not into the chat", () => {
  const own = delegateTurn("d1");
  const child = [
    ...childCall("d1", 10, { input: 100, output: 20 }, 0),
    ...childRead("d1", "k1", "a.py", 12),
    ...childRead("d1", "k2", "b.py", 15),
    ...childCall("d1", 20, { input: 300, output: 620 }, 0.5),
  ];
  const before = own.reduce(reduceChat, emptyChat);
  const after = [...own, ...child].reduce(reduceChat, emptyChat);
  assert.equal(after.messages.length, before.messages.length);
  assert.deepEqual(after.context, before.context);
  assert.deepEqual(after.calls, before.calls);
  const step = after.messages[0]?.tools?.[0];
  assert.equal(step?.status, "requested");
  assert.deepEqual(step?.child?.toolSteps.map((tool) => [tool.callId, tool.name, tool.status]), [
    ["k1", "read_file", "done"],
    ["k2", "read_file", "done"],
  ]);
  assert.equal(step?.child?.model, "qwen3:27b");
  assert.equal(step?.child?.modelCalls, 2);
  assert.equal(step?.child?.tokens, 1040);
  assert.equal(step?.child?.costUsd, 0.5);
  assert.equal(step?.child?.answerTokens, 620);
  assert.equal(step?.child?.status, "running");
});

test("a helper still running has its open call, and ends with the delegate call", () => {
  const events = [...delegateTurn("d1"), ...childCall("d1", 10, { input: 1, output: 1 }, 0), ...childRead("d1", "k1", "a.py", 12, false)];
  const running = events.reduce(reduceChat, emptyChat).messages[0]?.tools?.[0];
  assert.deepEqual([running?.child?.status, running?.child?.toolSteps[0]?.status], ["running", "running"]);
  const end: ChatEvent = {
    ...helperBase,
    ts: "2026-11-01T10:01:13.000Z",
    seq: 40,
    type: "tool.completed",
    data: { call_id: "d1", summary: "explorer finished", preview: "found it" },
  };
  const done = reduceChat(events.reduce(reduceChat, emptyChat), end).messages[0]?.tools?.[0];
  assert.deepEqual([done?.status, done?.child?.status, done?.preview], ["done", "done", "found it"]);
  assert.equal(done?.child?.durationMs, 71000);
});

test("two delegates in one turn stay apart", () => {
  const events = [
    ...delegateTurn("d1", "d2"),
    ...childRead("d1", "k1", "a.py", 10),
    ...childRead("d2", "k2", "b.py", 20),
    ...childRead("d1", "k3", "c.py", 30),
  ];
  const tools = events.reduce(reduceChat, emptyChat).messages[0]?.tools ?? [];
  assert.deepEqual(tools.map((tool) => tool.child?.toolSteps.map((step) => step.callId)), [["k1", "k3"], ["k2"]]);
});

function helperEvents(): ChatEvent[] {
  const at = "2026-11-01T10:00:02.000Z";
  const base = { ...helperBase, ts: at };
  const step = (seq: number, id: string, path: string, status: "running" | "done"): ChatEvent => ({
    ...base,
    seq,
    type: "helper.step",
    data: { call_id: "d1", index: 0, step_id: id, name: "read_file", args: { path }, status, calls: 1 },
  });
  return [
    {
      ...base,
      seq: 10,
      type: "helper.started",
      data: { call_id: "d1", index: 0, helper_id: "h1", agent: "explorer", label: "explorer", model: "qwen3:27b", wish: "same", pick_reason: "" },
    },
    { ...base, seq: 11, type: "helper.state", data: { call_id: "d1", index: 0, state: "running" } },
    step(12, "k1", "a.py", "running"),
    step(13, "k1", "a.py", "done"),
    step(14, "k2", "b.py", "running"),
    step(15, "k2", "b.py", "done"),
    {
      ...base,
      seq: 16,
      type: "helper.ended",
      data: { call_id: "d1", index: 0, stopped: "done", model_calls: 2, tokens: 1040, answer_tokens: 620, cost_usd: 0.5, duration_ms: 71000, working_ms: 70000 },
    },
  ];
}

test("helper.model puts the model that ran on the helper of the lead's log", () => {
  const moved: ChatEvent = {
    ...helperBase,
    ts: "2026-11-01T10:00:03.000Z",
    seq: 11,
    type: "helper.model",
    data: { call_id: "d1", index: 0, helper_id: "h1", model: "qwen3:14b", pick_reason: "you said no" },
  };
  const [started] = helperEvents();
  const state = [...delegateTurn("d1"), started!, moved].reduce(reduceChat, emptyChat);
  const child = state.messages[0]?.tools?.[0]?.child;
  assert.deepEqual(child?.helpers.map(({ id, model }) => ({ id, model })), [{ id: "h1", model: "qwen3:14b" }]);
  assert.equal(child?.model, "qwen3:14b");
});

test("helper events fold into the same helper run as the events with a parent call id", () => {
  const end: ChatEvent = {
    ...helperBase,
    ts: "2026-11-01T10:01:13.000Z",
    seq: 40,
    type: "tool.completed",
    data: { call_id: "d1", summary: "explorer finished", preview: "found it", duration_ms: 71000 },
  };
  const old = [
    ...delegateTurn("d1"),
    ...childCall("d1", 10, { input: 100, output: 20 }, 0),
    ...childRead("d1", "k1", "a.py", 12),
    ...childRead("d1", "k2", "b.py", 15),
    ...childCall("d1", 20, { input: 300, output: 620 }, 0.5),
    end,
  ].reduce(reduceChat, emptyChat);
  const now = [...delegateTurn("d1"), ...helperEvents(), end].reduce(reduceChat, emptyChat);
  const oldStep = old.messages[0]?.tools?.[0];
  const newStep = now.messages[0]?.tools?.[0];
  const plain = (step: typeof oldStep) => ({
    ...step?.child,
    toolSteps: step?.child?.toolSteps.map(({ callId, name, args, status }) => ({ callId, name, args, status })),
    startedAt: null,
    // Only the new events name the helper's own session.
    helpers: [],
  });
  assert.deepEqual(plain(newStep), plain(oldStep));
  assert.deepEqual(
    newStep?.child?.helpers.map(({ id, index, agent, model, ended }) => ({ id, index, agent, model, calls: ended?.modelCalls })),
    [{ id: "h1", index: 0, agent: "explorer", model: "qwen3:27b", calls: 2 }],
  );
  assert.equal(newStep?.child?.status, "done");
  assert.equal(helperLine(newStep!), helperLine(oldStep!));
  assert.equal(now.messages.length, old.messages.length);
});

test("a helper step carries the summary of its ended call, and a step without one has none", () => {
  const summarised = helperEvents().map((event): ChatEvent =>
    event.type === "helper.step" && event.data.status === "done" && event.data.step_id === "k1"
      ? { ...event, data: { ...event.data, summary: "3 lines" } }
      : event,
  );
  const steps = [...delegateTurn("d1"), ...summarised].reduce(reduceChat, emptyChat).messages[0]?.tools?.[0]?.child?.toolSteps;
  assert.equal(steps?.find((step) => step.callId === "k1")?.summary, "3 lines");
  // An older log has no summary: the step has none, and the card says "done".
  assert.equal(steps?.find((step) => step.callId === "k2")?.summary, undefined);
  assert.equal("summary" in (steps?.find((step) => step.callId === "k2") ?? {}), false);
});

test("a helper that stopped with failed is failed, and a helper event with no delegate call changes nothing", () => {
  const failed = helperEvents().map((event): ChatEvent =>
    event.type === "helper.ended" ? { ...event, data: { ...event.data, stopped: "failed" } } : event,
  );
  const step = [...delegateTurn("d1"), ...failed].reduce(reduceChat, emptyChat).messages[0]?.tools?.[0];
  assert.equal(step?.child?.status, "failed");
  assert.deepEqual(helperEvents().reduce(reduceChat, emptyChat), emptyChat);
});

test("a child event for a delegate call that is not there changes nothing", () => {
  const state = reduceChat(emptyChat, childRead("nope", "k1", "a.py", 1)[0]!);
  assert.deepEqual(state, emptyChat);
});

test("tool.completed with a diff replaces the approval diff, one without keeps it", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const head: ChatEvent[] = [
    { ...base, seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    {
      ...base,
      seq: 3,
      type: "tool.requested",
      data: { call_id: "c1", message_id: "a", name: "edit_file", args: { path: "a.py" } },
    },
    {
      ...base,
      seq: 4,
      type: "approval.needed",
      data: { call_id: "c1", name: "edit_file", args: { path: "a.py" }, source: "rule", diff: "approved diff" },
    },
  ];
  const done = (data: object): ChatEvent =>
    ({ ...base, seq: 5, type: "tool.completed", data: { call_id: "c1", summary: "s", preview: "p", ...data } }) as ChatEvent;
  const applied = [...head, done({ diff: "applied diff" })].reduce(reduceChat, emptyChat);
  assert.equal(applied.messages[0]?.tools?.[0]?.diff, "applied diff");
  const kept = [...head, done({})].reduce(reduceChat, emptyChat);
  assert.equal(kept.messages[0]?.tools?.[0]?.diff, "approved diff");
});

test("approval events set and clear the waiting call", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const events: ChatEvent[] = [
    { ...base, seq: 1, type: "run.started", data: {} },
    { ...base, seq: 2, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, seq: 3, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    {
      ...base,
      seq: 4,
      type: "tool.requested",
      data: { call_id: "c1", message_id: "a", name: "read_file", args: { path: "x" } },
    },
    {
      ...base,
      seq: 5,
      type: "approval.needed",
      data: { call_id: "c1", message_id: "a", name: "read_file", args: { path: "x" }, source: "rule" },
    },
  ];
  const waiting = events.reduce(reduceChat, emptyChat);
  assert.deepEqual(waiting.approval, {
    callId: "c1",
    name: "read_file",
    args: { path: "x" },
    source: "rule",
    diff: null,
  });
  const withDiff = reduceChat(waiting, {
    ...base,
    seq: 6,
    type: "approval.needed",
    data: { call_id: "c1", name: "edit_file", args: { path: "x" }, source: "rule", diff: "-a\n+b\n" },
  });
  assert.equal(withDiff.approval?.diff, "-a\n+b\n");
  assert.equal(waiting.messages[0]?.tools?.[0]?.diff, undefined);
  assert.equal(waiting.busy, true);
  assert.equal(waiting.messages[0]?.tools?.[0]?.status, "waiting");

  const answered = reduceChat(waiting, {
    ...base,
    seq: 6,
    type: "approval.resolved",
    data: { call_id: "c1", name: "read_file", decision: "allow" },
  });
  assert.equal(answered.approval, null);
  assert.equal(answered.messages[0]?.tools?.[0]?.status, "requested");
  const edited = reduceChat(waiting, {
    ...base,
    seq: 6,
    type: "approval.resolved",
    data: { call_id: "c1", name: "read_file", decision: "allow", args: { path: "y" } },
  });
  assert.deepEqual(edited.messages[0]?.tools?.[0]?.args, { path: "y" });

  const cancelled = reduceChat(waiting, { ...base, seq: 6, type: "run.cancelled", data: { reason: "user" } });
  assert.equal(cancelled.approval, null);
  assert.equal(cancelled.busy, false);
});

test("tool output appends to the running call and keeps only its newest part", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  let state = [
    { ...base, seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, seq: 2, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    {
      ...base,
      seq: 3,
      type: "tool.requested",
      data: { call_id: "c1", message_id: "a", name: "shell", args: { command: "x" } },
    },
    { ...base, seq: 4, type: "tool.started", data: { call_id: "c1" } },
    { ...base, seq: 5, type: "tool.output", data: { call_id: "c1", text: "a\n" } },
    { ...base, seq: 6, type: "tool.output", data: { call_id: "c1", text: "b\n" } },
  ].reduce((current, event) => reduceChat(current, event as ChatEvent), emptyChat);
  assert.equal(state.messages[0]?.tools?.[0]?.output, "a\nb\n");
  state = reduceChat(state, { ...base, seq: 7, type: "tool.output", data: { call_id: "c1", text: "x".repeat(5000) } });
  assert.equal(state.messages[0]?.tools?.[0]?.output?.length, 4000);
});

test("the todo list is the newest todos.updated", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const plan = (status: "pending" | "done") => ({
    ...base,
    seq: 1,
    type: "todos.updated" as const,
    data: { call_id: "c1", todos: [{ id: "1", text: "add a flag", status }] },
  });
  const first = reduceChat(emptyChat, plan("pending"));
  assert.deepEqual(first.todos, [{ id: "1", text: "add a flag", status: "pending" }]);
  assert.equal(reduceChat(first, plan("done")).todos[0]?.status, "done");
  const cleared = reduceChat(first, { ...base, seq: 2, type: "todos.updated", data: { todos: [] } });
  assert.deepEqual(cleared.todos, []);
});

test("a daemon shutdown keeps its notice in the banner", () => {
  const stopped = reduceChat({ ...emptyChat, busy: true, runId: "r" }, {
    seq: 1,
    session_id: "s",
    run_id: "r",
    ts: "t",
    type: "run.cancelled",
    data: { reason: "shutdown" },
  });
  assert.equal(stopped.notice, SHUTDOWN_NOTICE);
});

test("a finished download takes its progress out of the banner, and nothing else", () => {
  assert.equal(downloadEnded({ ...emptyChat, notice: "downloading ollama/qwen3.5:4b 40%" }).notice, null);
  const other = { ...emptyChat, notice: "open a session first" };
  assert.equal(downloadEnded(other), other);
});

test("a replayed user message that ran a skill keeps its skill marker", () => {
  const events = [
    { seq: 1, session_id: "s", run_id: "r", ts: "t", type: "run.started", data: {} },
    {
      seq: 2,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "skill.activated",
      data: { name: "ship", source: "project", how: "invoked", path: "/p/.agents/skills/ship", hash: "h" },
    },
    {
      seq: 3,
      session_id: "s",
      run_id: "r",
      ts: "t",
      type: "message.completed",
      data: { message_id: "u1", role: "user", text: "Open a PR: x\n", skill: { name: "ship", args: "x" } },
    },
    { seq: 4, session_id: "s", run_id: "r", ts: "t", type: "message.completed", data: { message_id: "u2", role: "user", text: "plain" } },
  ] satisfies ChatEvent[];
  const live = events.reduce(reduceChat, emptyChat);
  assert.deepEqual(live.messages[0]?.skill, { name: "ship", args: "x" });
  assert.equal(live.messages[0]?.text, "Open a PR: x\n");
  assert.equal("skill" in (live.messages[1] ?? {}), false);
});

test("pins and unpins become the active skills, in pin order; an invoked skill is not one", () => {
  const activated = (seq: number, name: string, how: "pinned" | "invoked") =>
    ({
      seq,
      session_id: "s",
      run_id: null,
      ts: "t",
      type: "skill.activated",
      data: { name, source: "user", how, path: `/skills/${name}`, hash: "h" },
    }) satisfies ChatEvent;
  const events = [
    activated(1, "terse", "pinned"),
    activated(2, "polite", "pinned"),
    activated(3, "ship", "invoked"),
    activated(4, "terse", "pinned"),
    { seq: 5, session_id: "s", run_id: null, ts: "t", type: "skill.deactivated", data: { name: "terse", reason: "unpinned" } },
  ] satisfies ChatEvent[];
  const states = events.map((_, index) => events.slice(0, index + 1).reduce(reduceChat, emptyChat).activeSkills);
  assert.deepEqual(states, [["terse"], ["terse", "polite"], ["terse", "polite"], ["terse", "polite"], ["polite"]]);
});

test("a skipped pin is marked and named in a notice, until a call reads it again or it is unpinned", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" };
  const skipped = (seq: number, name: string) =>
    ({ ...base, seq, type: "skill.skipped", data: { name, reason: "missing", message: `no skill named ${name}` } }) satisfies ChatEvent;
  const activated = (seq: number, name: string) =>
    ({ ...base, seq, type: "skill.activated", data: { name, source: "user", how: "pinned", path: `/s/${name}`, hash: "h2" } }) satisfies ChatEvent;
  const pinned = [activated(1, "terse"), activated(2, "polite")].reduce(reduceChat, emptyChat);

  const gone = [skipped(3, "terse"), skipped(4, "terse")].reduce(reduceChat, pinned);
  assert.deepEqual(gone.skippedSkills, ["terse"]);
  assert.deepEqual(gone.activeSkills, ["terse", "polite"]);
  assert.equal(gone.notice, skippedNotice("terse", "no skill named terse"));
  assert.equal(gone.notice, "no skill named terse, so terse is left out. It stays pinned: fix it, or /skill unpin terse");

  const back = reduceChat(gone, activated(5, "terse"));
  assert.deepEqual(back.skippedSkills, []);
  assert.equal(back.notice, null);

  const unpinned = reduceChat(gone, {
    ...base,
    run_id: null,
    seq: 5,
    type: "skill.deactivated",
    data: { name: "terse", reason: "unpinned" },
  });
  assert.deepEqual([unpinned.skippedSkills, unpinned.activeSkills, unpinned.notice], [[], ["polite"], null]);

  const other = reduceChat({ ...gone, notice: "something else" }, activated(5, "terse"));
  assert.equal(other.notice, "something else");
});

test("the diff from approval.needed stays on the tool after the answer", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const events: ChatEvent[] = [
    { ...base, seq: 1, type: "run.started", data: {} },
    { ...base, seq: 2, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, seq: 3, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    { ...base, seq: 4, type: "tool.requested", data: { call_id: "c1", message_id: "a", name: "edit_file", args: { path: "x" } } },
    { ...base, seq: 5, type: "approval.needed", data: { call_id: "c1", name: "edit_file", args: { path: "x" }, source: "rule", diff: "-a\n+b\n" } },
    { ...base, seq: 6, type: "approval.resolved", data: { call_id: "c1", name: "edit_file", decision: "allow" } },
  ];
  const state = events.reduce(reduceChat, emptyChat);
  assert.equal(state.approval, null);
  assert.equal(state.messages[0]?.tools?.[0]?.diff, "-a\n+b\n");
});

function approvalEvents(resolved: Record<string, unknown> | null): ChatEvent[] {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const events: ChatEvent[] = [
    { ...base, seq: 1, type: "run.started", data: {} },
    { ...base, seq: 2, type: "message.started", data: { message_id: "a", role: "assistant" } },
    { ...base, seq: 3, type: "message.completed", data: { message_id: "a", role: "assistant", text: "" } },
    { ...base, seq: 4, type: "tool.requested", data: { call_id: "c1", message_id: "a", name: "edit_file", args: { path: "x" } } },
    { ...base, seq: 5, type: "approval.needed", data: { call_id: "c1", name: "edit_file", args: { path: "x" }, source: "built-in default", subject: "x" } },
  ];
  if (resolved !== null) {
    events.push({ ...base, seq: 6, type: "approval.resolved", data: { call_id: "c1", name: "edit_file", ...resolved } } as ChatEvent);
  }
  return events;
}

test("approval.needed records the question on the tool", () => {
  const state = approvalEvents(null).reduce(reduceChat, emptyChat);
  assert.deepEqual(state.messages[0]?.tools?.[0]?.approval, { source: "built-in default", subject: "x" });
});

test("approval.resolved records each decision as the answer", () => {
  for (const decision of ["allow", "allow_session", "allow_always", "deny"] as const) {
    const state = approvalEvents({ decision }).reduce(reduceChat, emptyChat);
    assert.deepEqual(state.messages[0]?.tools?.[0]?.approval?.answer, { decision, rule: null, edited: false });
  }
  const always = approvalEvents({ decision: "allow_always", rule: "edit_file(x) → allow" }).reduce(reduceChat, emptyChat);
  assert.equal(always.messages[0]?.tools?.[0]?.approval?.answer?.rule, "edit_file(x) → allow");
});

test("approval.resolved with edited arguments marks the answer edited", () => {
  const state = approvalEvents({ decision: "allow", args: { path: "y" } }).reduce(reduceChat, emptyChat);
  const tool = state.messages[0]?.tools?.[0];
  assert.equal(tool?.approval?.answer?.edited, true);
  assert.deepEqual(tool?.args, { path: "y" });
});

test("approval.resolved without a question first still records the answer", () => {
  const events = approvalEvents({ decision: "deny", subject: "x" });
  events.splice(4, 1);
  const state = events.reduce(reduceChat, emptyChat);
  assert.deepEqual(state.messages[0]?.tools?.[0]?.approval, {
    source: "",
    subject: "x",
    answer: { decision: "deny", rule: null, edited: false },
  });
});

test("replaying the approval events twice gives the same tool", () => {
  const events = approvalEvents({ decision: "allow_session" });
  const once = events.reduce(reduceChat, emptyChat);
  const twice = [...events, ...events.slice(3)].reduce(reduceChat, emptyChat);
  assert.deepEqual(twice.messages[0]?.tools?.[0]?.approval, once.messages[0]?.tools?.[0]?.approval);
});

function call(type: "model.call.started" | "model.call.completed", id: string, data: Record<string, unknown>): ChatEvent {
  return { seq: 1, session_id: "s", run_id: "r", ts: "t", type, data: { message_id: id, ...data } } as ChatEvent;
}

test("the newest call's context comes from model.call.started and completed, and a second call replaces it", () => {
  let state = reduceChat(emptyChat, call("model.call.started", "m1", { context_window: 8000, num_ctx: 4000 }));
  assert.equal(state.context.last, null);
  state = reduceChat(state, call("model.call.completed", "m1", { usage: { input: 1200, output: 5 } }));
  assert.deepEqual(state.context.last, { spanId: "m1", used: 1200, window: 8000, windowEstimated: false, windowPlanned: false, numCtx: 4000 });
  state = reduceChat(state, call("model.call.started", "m2", { context_window: 8000 }));
  state = reduceChat(state, call("model.call.completed", "m2", { usage: { input: 2400, output: 5 } }));
  assert.deepEqual(state.context.last, { spanId: "m2", used: 2400, window: 8000, windowEstimated: false, windowPlanned: false, numCtx: null });
});

test("an event that changes neither the chat nor the context returns the same state", () => {
  const same = reduceChat(emptyChat, { seq: 1, session_id: "s", run_id: "r", ts: "t", type: "session.updated", data: {} } as unknown as ChatEvent);
  assert.equal(same, emptyChat);
});

test("model.options.changed keeps the session's whole set of overrides", () => {
  const event = (options: Record<string, number | string>): ChatEvent => ({
    seq: 2,
    session_id: "s",
    run_id: null,
    ts: "t",
    type: "model.options.changed",
    data: { options },
  });
  assert.deepEqual(emptyChat.options, {});
  const set = reduceChat(emptyChat, event({ top_k: 5, seed: 7 }));
  assert.deepEqual(set.options, { top_k: 5, seed: 7 });
  assert.deepEqual(reduceChat(set, event({ top_k: 5 })).options, { top_k: 5 });
});

test("session.mode.changed keeps the session's permission mode override, null when removed", () => {
  const event = (mode: "careful" | "balanced" | "autopilot" | null): ChatEvent => ({
    seq: 2,
    session_id: "s",
    run_id: null,
    ts: "t",
    type: "session.mode.changed",
    data: { mode },
  });
  assert.equal(emptyChat.permissionMode, null);
  const set = reduceChat(emptyChat, event("autopilot"));
  assert.equal(set.permissionMode, "autopilot");
  assert.equal(reduceChat(set, event(null)).permissionMode, null);
});

test("a call written as text that golem could not read sets the notice flag until the next run", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" };
  const completed = (seq: number, text_tool_calls?: "recovered" | "unread") =>
    ({
      ...base,
      seq,
      type: "model.call.completed",
      data: { message_id: "m", latency_ms: 5, failed: false, ...(text_tool_calls ? { text_tool_calls } : {}) },
    }) satisfies ChatEvent;
  assert.equal(reduceChat(emptyChat, completed(1)).unreadCall, false);
  assert.equal(reduceChat(emptyChat, completed(1, "recovered")).unreadCall, false);
  const unread = reduceChat(emptyChat, completed(1, "unread"));
  assert.equal(unread.unreadCall, true);
  assert.equal(reduceChat(unread, completed(2)).unreadCall, true);
  const next = reduceChat(unread, { ...base, seq: 3, type: "run.started", data: {} });
  assert.equal(next.unreadCall, false);
});

test("the notice for a call written as text names the slash command in the TUI and the tab in the web", () => {
  assert.equal(
    unreadCallNotice("tui"),
    "The model wrote a tool call as text, and golem couldn't read it. Ask again, or try /tune → precise (a lower temperature makes this rarer).",
  );
  assert.equal(
    unreadCallNotice("web"),
    "The model wrote a tool call as text, and golem couldn't read it. Ask again, or try the Tune tab → precise (a lower temperature makes this rarer).",
  );
});

function thinkingEvent(type: "message.started" | "message.thinking.delta" | "message.delta" | "message.completed", data: object): ChatEvent {
  return { seq: 1, session_id: "s", run_id: "r", ts: "t", type, data } as ChatEvent;
}

test("thinking deltas fold into message.thinking, apart from the text", () => {
  let state = reduceChat(emptyChat, thinkingEvent("message.started", { message_id: "a", role: "assistant" }));
  state = reduceChat(state, thinkingEvent("message.thinking.delta", { message_id: "a", text: "Let me " }));
  state = reduceChat(state, thinkingEvent("message.thinking.delta", { message_id: "a", text: "see" }));
  assert.equal(state.messages[0]?.thinking, "Let me see");
  assert.equal(state.messages[0]?.text, "");
  state = reduceChat(state, thinkingEvent("message.delta", { message_id: "a", text: "391" }));
  assert.equal(state.messages[0]?.text, "391");
  assert.equal(state.messages[0]?.thinking, "Let me see");
});

test("message.completed sets the whole thinking and its time", () => {
  let state = reduceChat(emptyChat, thinkingEvent("message.started", { message_id: "a", role: "assistant" }));
  state = reduceChat(state, thinkingEvent("message.thinking.delta", { message_id: "a", text: "part" }));
  state = reduceChat(
    state,
    thinkingEvent("message.completed", {
      message_id: "a",
      role: "assistant",
      text: "391",
      thinking: "whole thought",
      thinking_ms: 12_400,
    }),
  );
  assert.equal(state.messages[0]?.thinking, "whole thought");
  assert.equal(state.messages[0]?.thinkingMs, 12_400);
  assert.equal(state.messages[0]?.streaming, false);
});

test("a completed message without thinking has none", () => {
  const state = reduceChat(
    emptyChat,
    thinkingEvent("message.completed", { message_id: "a", role: "assistant", text: "hi", thinking: null, thinking_ms: null }),
  );
  assert.equal(state.messages[0]?.thinking, undefined);
  assert.equal(state.messages[0]?.thinkingMs, undefined);
});

test("a cancelled reply keeps the thinking that streamed", () => {
  let state = reduceChat(emptyChat, thinkingEvent("message.started", { message_id: "a", role: "assistant" }));
  state = reduceChat(state, thinkingEvent("message.thinking.delta", { message_id: "a", text: "half" }));
  state = reduceChat(
    state,
    thinkingEvent("message.completed", { message_id: "a", role: "assistant", text: "", interrupted: true }),
  );
  assert.equal(state.messages[0]?.thinking, "half");
});

test("thinkingLine covers each state", () => {
  const base = { streaming: false, text: "391" };
  assert.equal(thinkingLine({ ...base }), null);
  assert.equal(thinkingLine({ ...base, thinking: "" }), null);
  assert.equal(thinkingLine({ streaming: true, text: "", thinking: "hm" }), "thinking…");
  assert.equal(thinkingLine({ streaming: true, text: "3", thinking: "hm" }), "thought");
  assert.equal(thinkingLine({ ...base, thinking: "hm", thinkingMs: 12_400 }), "thought for 12s");
  assert.equal(thinkingLine({ ...base, thinking: "hm", thinkingMs: 200 }), "thought for <1s");
  assert.equal(thinkingLine({ ...base, thinking: "hm", thinkingMs: 65_000 }), "thought for 1m 05s");
  assert.equal(thinkingLine({ ...base, thinking: "hm" }), "thought");
  assert.equal(thinkingLine({ streaming: true, text: "", thinking: undefined }), null);
});

test("a reply that hit the length limit is marked cut unless it asked for a tool", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const call = (id: string, reason: string): ChatEvent => ({
    ...base,
    seq: 2,
    type: "model.call.completed",
    data: { message_id: id, stop_reason: reason, latency_ms: 5 },
  });
  const done = (id: string): ChatEvent => ({
    ...base,
    seq: 1,
    type: "message.completed",
    data: { message_id: id, role: "assistant", text: "partial" },
  });
  const tool = (id: string): ChatEvent => ({
    ...base,
    seq: 3,
    type: "tool.requested",
    data: { call_id: "c1", message_id: id, name: "read_file", args: {} },
  });
  const run = (events: ChatEvent[]) => events.reduce(reduceChat, emptyChat).messages[0];
  assert.equal(run([done("a"), call("a", "length")])?.cut, true);
  assert.equal(run([done("a"), call("a", "max_tokens")])?.cut, true);
  assert.equal(run([done("a"), call("a", "stop")])?.cut, undefined);
  assert.equal(run([done("a"), call("a", "length"), tool("a")])?.cut, undefined);
});

test("tool.writing sets what the reply is writing, and the reply completing, a request, or the run ending clears it", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const started: ChatEvent = { ...base, seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } };
  const writing = (seq: number, path: string | null, lines: number, chars: number): ChatEvent => ({
    ...base,
    seq,
    type: "tool.writing",
    data: { message_id: "a", index: 0, name: "write_file", path, lines, chars },
  });
  let state = [started, writing(2, null, 0, 0)].reduce(reduceChat, emptyChat);
  assert.deepEqual(state.messages[0]?.writing, { name: "write_file", path: null, lines: 0, chars: 0 });
  state = reduceChat(state, writing(3, "src/a.ts", 12, 340));
  assert.deepEqual(state.messages[0]?.writing, { name: "write_file", path: "src/a.ts", lines: 12, chars: 340 });

  const completed = reduceChat(state, {
    ...base,
    seq: 4,
    type: "message.completed",
    data: { message_id: "a", role: "assistant", text: "" },
  });
  assert.equal(completed.messages[0]?.writing, undefined);

  const requested = reduceChat(state, {
    ...base,
    seq: 4,
    type: "tool.requested",
    data: { call_id: "c1", message_id: "a", name: "write_file", args: { path: "src/a.ts" } },
  });
  assert.equal(requested.messages[0]?.writing, undefined);
  assert.equal(requested.messages[0]?.tools?.length, 1);

  for (const type of ["run.completed", "run.cancelled", "run.failed"] as const) {
    const data = type === "run.cancelled" ? { reason: "user" } : type === "run.failed" ? { message: "x" } : {};
    const ended = reduceChat(state, { ...base, seq: 4, type, data } as ChatEvent);
    assert.equal(ended.messages[0]?.writing, undefined, type);
  }

  // A reply that was never opened is left alone.
  assert.deepEqual(reduceChat(emptyChat, writing(2, "x", 1, 1)), emptyChat);
  assert.equal(stopWriting(emptyChat), emptyChat);
});

test("model.waiting shows the local-model wait, and the first token, the end of the wait, or the run ending clears it", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const waiting = (seq: number, on: boolean): ChatEvent => ({
    ...base,
    seq,
    type: "model.waiting",
    data: { message_id: "a", waiting: on },
  });
  const started: ChatEvent = { ...base, seq: 1, type: "message.started", data: { message_id: "a", role: "assistant" } };
  const on = [started, waiting(2, true)].reduce(reduceChat, emptyChat);
  assert.equal(on.localWait, true);
  assert.equal(reduceChat(on, waiting(3, false)).localWait, false);
  const delta: ChatEvent = { ...base, seq: 3, type: "message.delta", data: { message_id: "a", text: "hi" } };
  assert.equal(reduceChat(on, delta).localWait, false);
  for (const type of ["run.completed", "run.cancelled"] as const) {
    assert.equal(reduceChat(on, { ...base, seq: 3, type, data: type === "run.cancelled" ? { reason: "user" } : {} } as ChatEvent).localWait, false);
  }
  assert.equal(emptyChat.localWait, false);
});

function contextEvent(seq: number, data: Extract<ChatEvent, { type: "context.changed" }>["data"]): ChatEvent {
  return event({ seq, session_id: "s", run_id: null, ts: "t", type: "context.changed", data });
}

test("branch.changed becomes a quiet line after the message it followed, and no message", () => {
  let state = reduceChat(
    emptyChat,
    event({ seq: 1, session_id: "s", run_id: "r", ts: "t", type: "message.completed", data: { message_id: "u", role: "user", text: "hi" } }),
  );
  state = reduceChat(
    state,
    event({ seq: 2, session_id: "s", run_id: "r", ts: "t", type: "branch.changed", data: { from_branch: "main", to_branch: "fix-x", paths_count: 3 } }),
  );
  assert.equal(state.messages.length, 1);
  assert.deepEqual(
    state.notices.map((n) => [n.afterId, n.action, n.text]),
    [["u", "branch", "The branch changed from main to fix-x. Files may differ from what golem read."]],
  );
  assert.equal(noticesAfter(state.notices, "u", true).length, 1);
});

test("branchChanged is true from branch.changed until the turn ends", () => {
  let state = reduceChat(emptyChat, event({ seq: 1, session_id: "s", run_id: "r", ts: "t", type: "run.started", data: {} }));
  assert.equal(state.branchChanged, false);
  state = reduceChat(
    state,
    event({ seq: 2, session_id: "s", run_id: "r", ts: "t", type: "branch.changed", data: { from_branch: "main", to_branch: "fix-x", paths_count: 3 } }),
  );
  assert.equal(state.branchChanged, true);
  state = reduceChat(state, event({ seq: 3, session_id: "s", run_id: "r", ts: "t", type: "run.completed", data: {} }));
  assert.equal(state.branchChanged, false);
});

test("context.changed becomes a notice after the message it followed, and no message", () => {
  let state = reduceChat(
    emptyChat,
    event({ seq: 1, session_id: "s", run_id: "r", ts: "t", type: "message.completed", data: { message_id: "u", role: "user", text: "hi" } }),
  );
  state = reduceChat(state, contextEvent(2, { action: "cleared", before_tokens: 710, after_tokens: 380, count: 12, room: 1000 }));
  state = reduceChat(state, contextEvent(3, { action: "summarised", before_tokens: 840, after_tokens: 310, count: 9, room: 1000 }));
  assert.equal(state.messages.length, 1);
  assert.deepEqual(
    state.notices.map((n) => [n.afterId, n.action, n.text]),
    [
      ["u", "cleared", "golem cleared 12 old tool results · ctx 71% → 38%"],
      ["u", "summarised", "golem summarised 9 earlier turns · ctx 84% → 31%"],
    ],
  );
  assert.equal(state.clearedNow, 12);
  assert.deepEqual(noticesAfter(state.notices, "u", true).map((n) => n.action), ["summarised"]);
  assert.equal(noticesAfter(state.notices, null).length, 0);
  state = reduceChat(state, event({ seq: 4, session_id: "s", run_id: "r2", ts: "t", type: "run.started", data: {} } as ChatEvent));
  assert.equal(state.clearedNow, 0);
  assert.equal(state.notices.length, 2);
});

test("a notice before any message is at the top", () => {
  const state = reduceChat(emptyChat, contextEvent(1, { action: "grew", window_from: 32768, window_to: 65536, reload_ms: 8000 }));
  assert.equal(state.notices[0]?.afterId, null);
  assert.equal(state.notices[0]?.text, "window grew 32K → 64K · reloaded in 8 s");
});

test("a call that loads the model with a larger window shows it until the first token, then the chat says it grew", () => {
  const base = { session_id: "s", run_id: "r", ts: "t" } as const;
  const loading: ChatEvent = {
    ...base,
    seq: 2,
    type: "model.waiting",
    data: { message_id: "a", waiting: true, model: "qwen3:8b", window: 65_536 },
  };
  const on = reduceChat(emptyChat, loading);
  assert.deepEqual(on.loading, { model: "qwen3:8b", window: 65_536 });
  const delta: ChatEvent = { ...base, seq: 3, type: "message.delta", data: { message_id: "a", text: "hi" } };
  assert.equal(reduceChat(on, delta).loading, null);
  const grew: ChatEvent = {
    ...base,
    seq: 4,
    type: "context.changed",
    data: { action: "grew", window_from: 32_768, window_to: 65_536, reload_ms: 8_200 },
  };
  assert.equal(reduceChat(on, grew).notices[0]?.text, "window grew 32K → 64K · reloaded in 8 s");
});
