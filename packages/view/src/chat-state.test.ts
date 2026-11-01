import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import {
  appendDelta,
  forkPoint,
  downloadEnded,
  SHUTDOWN_NOTICE,
  skippedNotice,
  createDeltaBatcher,
  emptyChat,
  failureText,
  providersUp,
  reduceChat,
  serverUp,
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
