import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { emptyChat, reduceChat } from "./chat-state.ts";
import {
  checksOf,
  checksQuestion,
  checksSummary,
  noChecks,
  outputTail,
  reduceChecks,
  type ChecksState,
} from "./checks.ts";

let seq = 0;
function event(type: string, data: Record<string, unknown>, runId: string | null = "r1"): ChatEvent {
  seq += 1;
  return { seq, session_id: "s", run_id: runId, ts: "t", type, data } as unknown as ChatEvent;
}

const started = (id: string, name: string, round = 0) =>
  event("check.started", { check_id: id, name, command: `run ${name}`, round });
const completed = (id: string, name: string, status: string, round = 0, extra: Record<string, unknown> = {}) =>
  event("check.completed", {
    check_id: id,
    name,
    status,
    exit_code: status === "passed" ? 0 : status === "failed" ? 1 : null,
    duration_ms: 1000,
    output: "",
    round,
    ...extra,
  });

function fold(events: ChatEvent[], from: ChecksState = noChecks): ChecksState {
  return events.reduce(reduceChecks, from);
}

test("a started check is running, and its completion fills it in", () => {
  const running = fold([started("k1", "ruff")]);
  assert.equal(running.turns[0]?.runs[0]?.status, "running");
  assert.equal(running.turns[0]?.runs[0]?.command, "run ruff");
  const done = fold([completed("k1", "ruff", "failed", 0, { output: "E501", artifact_id: "a1" })], running);
  const run = done.turns[0]?.runs[0];
  assert.equal(done.turns[0]?.runs.length, 1);
  assert.equal(run?.status, "failed");
  assert.equal(run?.exitCode, 1);
  assert.equal(run?.output, "E501");
  assert.equal(run?.artifactId, "a1");
  assert.equal(run?.command, "run ruff");
});

test("an event that is not about checks returns the same state", () => {
  const state = fold([started("k1", "ruff")]);
  assert.equal(reduceChecks(state, event("run.started", {})), state);
  assert.equal(reduceChecks(state, event("check.started", { check_id: "x", name: "n", command: "c" }, null)), state);
});

test("the summary while checks run lists each one", () => {
  const state = fold([started("k1", "ruff"), completed("k1", "ruff", "passed"), started("k2", "tsc")]);
  const turn = checksOf(state, "r1");
  assert.deepEqual(turn && checksSummary(turn), { tone: "run", text: "◐ checking…", detail: "ruff ✓ · tsc running" });
});

test("the summary of passed checks gives names and the total time", () => {
  const state = fold([
    started("k1", "ruff"),
    completed("k1", "ruff", "passed", 0, { duration_ms: 2200 }),
    started("k2", "tsc"),
    completed("k2", "tsc", "passed", 0, { duration_ms: 4000 }),
  ]);
  const turn = checksOf(state, "r1");
  assert.deepEqual(turn && checksSummary(turn), { tone: "ok", text: "✓ checks passed", detail: "ruff · tsc · 6.2 s" });
});

test("a failure is being fixed while the run goes on, and is final once it ended", () => {
  const state = fold([started("k1", "ruff"), completed("k1", "ruff", "failed")]);
  const turn = checksOf(state, "r1");
  assert.ok(turn);
  assert.deepEqual(checksSummary(turn, true), { tone: "bad", text: "✗ ruff: failed", detail: "golem is fixing · round 1" });
  assert.deepEqual(checksSummary(turn, false), { tone: "bad", text: "✗ ruff: failed", detail: "still failing" });
});

test("failed in round 0 and passed in round 1 reads as passed", () => {
  const state = fold([
    started("k1", "ruff"),
    completed("k1", "ruff", "failed"),
    started("k2", "ruff", 1),
    completed("k2", "ruff", "passed", 1),
  ]);
  const turn = checksOf(state, "r1");
  assert.equal(turn?.runs.length, 2);
  assert.equal(turn && checksSummary(turn).tone, "ok");
});

test("still failing after the last round names the rounds", () => {
  const state = fold([
    started("k1", "tsc"),
    completed("k1", "tsc", "failed"),
    started("k2", "tsc", 1),
    completed("k2", "tsc", "failed", 1),
    started("k3", "tsc", 2),
    completed("k3", "tsc", "timed_out", 2),
  ]);
  const turn = checksOf(state, "r1");
  assert.deepEqual(turn && checksSummary(turn), { tone: "bad", text: "✗ tsc: timed out", detail: "still failing after 2 rounds" });
});

test("runs of two turns stay apart", () => {
  const state = fold([started("k1", "ruff"), event("check.started", { check_id: "k2", name: "ruff", command: "c", round: 0 }, "r2")]);
  assert.deepEqual(
    state.turns.map((turn) => turn.runId),
    ["r1", "r2"],
  );
  assert.equal(checksOf(state, "r3"), null);
  assert.equal(checksOf(state, null), null);
});

test("the offer holds the checks until an answer, which holds the choice", () => {
  const offered = fold([event("check.offered", { checks: [{ name: "ruff", command: "ruff check ." }] })]);
  assert.deepEqual(offered.offered, [{ name: "ruff", command: "ruff check ." }]);
  assert.equal(offered.allowed, null);
  assert.deepEqual(checksQuestion(offered.offered ?? []), { text: "Run checks after golem edits?", commands: ["ruff check ."] });
  const yes = fold([event("session.checks.changed", { on: true }, null)], offered);
  assert.equal(yes.offered, null);
  assert.equal(yes.allowed, true);
  assert.equal(fold([event("session.checks.changed", { on: false }, null)], offered).allowed, false);
});

test("the output tail keeps the last rows and drops blank ones at the end", () => {
  assert.deepEqual(outputTail("a\nb\nc\n\n", 2), ["b", "c"]);
  assert.deepEqual(outputTail("  \n"), []);
});

test("the chat state folds the checks and remembers each reply's run", () => {
  let state = reduceChat(emptyChat, event("message.started", { message_id: "m1" }));
  state = reduceChat(state, event("check.started", { check_id: "k1", name: "ruff", command: "c", round: 0 }));
  assert.equal(state.messages[0]?.runId, "r1");
  assert.equal(state.checks.turns.length, 1);
  state = reduceChat(state, event("message.completed", { message_id: "m1", role: "assistant", text: "done" }));
  assert.equal(state.messages[0]?.runId, "r1");
});
