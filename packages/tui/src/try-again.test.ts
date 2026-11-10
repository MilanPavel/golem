import assert from "node:assert/strict";
import { test } from "node:test";

import { planTry, startedTry, tuneState, type TryPlan, type TuneState } from "@golem/view";

import type { Press } from "./keys.ts";
import { pressTune, tuneKeyOf } from "./tune-panel.ts";
import { dropTry, startTry, tryLines, type TryClient } from "./try-again.ts";

const tune: TuneState = tuneState({
  model: "qwen3:8b",
  options: [
    { name: "temperature", label: "temperature", kind: "float", minimum: 0, maximum: 2, step: 0.05, default: 0.8, short: "s", long: "l" },
  ],
  defaults: { temperature: 0.7 },
  saved: { temperature: 0.2 },
});

function plan(): Extract<TryPlan, { kind: "try" }> {
  const planned = planTry(
    {
      busy: false,
      messages: [
        { id: "m1", role: "user", text: "hi", streaming: false },
        { id: "m2", role: "assistant", text: "hello", streaming: false },
        { id: "m3", role: "user", text: "again", streaming: false },
        { id: "m4", role: "assistant", text: "first line\nsecond", streaming: false },
      ],
    },
    tune,
  );
  assert.equal(planned.kind, "try");
  return planned as Extract<TryPlan, { kind: "try" }>;
}

function fake(calls: string[]): TryClient {
  const record = (name: string, session: string, extra?: unknown) => {
    calls.push(`${name}:${session}${extra === undefined ? "" : `:${JSON.stringify(extra)}`}`);
  };
  return {
    forkSession: async (id: string, at: string) => {
      record("fork", id, at);
      return { session_id: "fork1" };
    },
    createSession: async () => {
      record("create", "-");
      return { session_id: "new1" };
    },
    attachSession: async (id: string) => {
      record("attach", id);
      return {};
    },
    renameSession: async (id: string, title: string) => {
      record("rename", id, title);
      return { title };
    },
    setSessionOptions: async (id: string, options: unknown) => {
      record("set_options", id, options);
      return { options };
    },
    sendMessage: async (id: string, text: string) => {
      record("send", id, text);
      return {};
    },
    cancelRun: async (id: string) => {
      record("cancel", id);
      return {};
    },
    detachSession: async (id: string) => {
      record("detach", id);
    },
  } as unknown as TryClient;
}

test("t forks, renames, sets options, and sends on the fork, never on the chat", async () => {
  const calls: string[] = [];
  const started: string[] = [];
  const id = await startTry(fake(calls), plan(), { sessionId: "chat1", cwd: "/w", profile: "p" }, "try · T", (s) => started.push(s));
  assert.equal(id, "fork1");
  assert.deepEqual(started, ["fork1"]);
  assert.deepEqual(calls, [
    'fork:chat1:"m2"',
    "attach:fork1",
    'rename:fork1:"try · T"',
    'set_options:fork1:{"temperature":0.2}',
    'send:fork1:"again"',
  ]);
  assert.ok(calls.slice(1).every((call) => !call.includes("chat1")));
});

test("a first question starts a fresh session instead of forking", async () => {
  const calls: string[] = [];
  const first = planTry({ busy: false, messages: [{ id: "m1", role: "user", text: "hi", streaming: false }] }, tune);
  if (first.kind !== "try") throw new Error("expected a plan");
  await startTry(fake(calls), first, { sessionId: "chat1", cwd: "/w", profile: undefined }, "try · hi", () => undefined);
  assert.equal(calls[0], "create:-");
  assert.equal(calls.at(-1), 'send:new1:"hi"');
});

test("t is a panel key that asks the app to try", () => {
  const press: Press = { name: null, input: "t", ctrl: false, meta: false };
  assert.equal(tuneKeyOf(press), "try");
  assert.deepEqual(pressTune(tune, "try").action, { kind: "try" });
});

test("dropping a try cancels its run and detaches the fork", async () => {
  const calls: string[] = [];
  dropTry(fake(calls), "r9", "fork1");
  await Promise.resolve();
  assert.deepEqual(calls, ["cancel:r9", "detach:fork1"]);
});

test("the block has the heading, the dim original, and a waiting mark before the run", () => {
  const run = startedTry("fork1", plan(), "try · temperature 0.2");
  assert.deepEqual(tryLines(run, 40), [
    { text: " try · temperature 0.2", dim: false },
    { text: " was: first line", dim: true },
    { text: " …", dim: true },
  ]);
});
