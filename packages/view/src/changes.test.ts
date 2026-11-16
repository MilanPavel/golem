import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";
import type { ChatMessage } from "./chat-state.ts";
import { changedPaths, changesLine, cutTitle, noChanges, reduceChanges, totals, turnCards, turnOf, type ChangesState, type TurnFile } from "./changes.ts";

type Over = {
  id: string;
  path?: string;
  status?: "created" | "modified" | "deleted";
  added?: number;
  removed?: number;
  source?: "tool" | "shell" | "revert";
  reverts?: string;
};

function change(run: string, over: Over): ChatEvent {
  return {
    type: "file.changed",
    run_id: run,
    seq: 1,
    session_id: "s",
    ts: "2026-01-01T00:00:00Z",
    data: {
      change_id: over.id,
      path: over.path ?? "a.py",
      status: over.status ?? "modified",
      added: over.added ?? 1,
      removed: over.removed ?? 0,
      source: over.source ?? "tool",
      ...(over.reverts === undefined ? {} : { reverts: over.reverts }),
    },
  } as ChatEvent;
}

function fold(events: ChatEvent[]): ChangesState {
  return events.reduce(reduceChanges, noChanges);
}

function file(added: number, removed: number): TurnFile {
  return { path: "x", status: "modified", added, removed, changeIds: [] };
}

test("one change makes one turn with one file", () => {
  const state = fold([change("r1", { id: "c1", added: 3, removed: 1 })]);
  assert.deepEqual(state.turns, [
    { runId: "r1", files: [{ path: "a.py", status: "modified", added: 3, removed: 1, changeIds: ["c1"] }], reverted: false },
  ]);
  assert.equal(turnOf(state, "r1"), state.turns[0]);
  assert.equal(turnOf(state, "r2"), null);
});

test("two changes to one file in a turn merge", () => {
  const state = fold([change("r1", { id: "c1", added: 3, removed: 1 }), change("r1", { id: "c2", added: 2, removed: 2 })]);
  assert.deepEqual(state.turns[0]?.files, [{ path: "a.py", status: "modified", added: 5, removed: 3, changeIds: ["c1", "c2"] }]);
});

test("two turns stay apart, in order of first change", () => {
  const state = fold([
    change("r1", { id: "c1" }),
    change("r2", { id: "c2", path: "b.py" }),
    change("r1", { id: "c3", path: "c.py" }),
  ]);
  assert.deepEqual(
    state.turns.map((turn) => [turn.runId, turn.files.map((f) => f.path)]),
    [
      ["r1", ["a.py", "c.py"]],
      ["r2", ["b.py"]],
    ],
  );
  assert.deepEqual(changedPaths(state), ["a.py", "c.py", "b.py"]);
});

test("created then modified stays created; a last delete wins", () => {
  const made = fold([change("r1", { id: "c1", status: "created" }), change("r1", { id: "c2" })]);
  assert.equal(made.turns[0]?.files[0]?.status, "created");
  const gone = fold([change("r1", { id: "c1", status: "created" }), change("r1", { id: "c2", status: "deleted" })]);
  assert.equal(gone.turns[0]?.files[0]?.status, "deleted");
  const back = fold([change("r1", { id: "c1", status: "deleted" }), change("r1", { id: "c2", status: "created" })]);
  assert.equal(back.turns[0]?.files[0]?.status, "modified");
});

test("a revert marks the turn and adds no file", () => {
  const state = fold([change("r1", { id: "c1" }), change("r2", { id: "c9", source: "revert", reverts: "c1" })]);
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0]?.reverted, true);
  assert.equal(state.turns[0]?.files.length, 1);
});

test("a revert of the revert unmarks it", () => {
  const state = fold([
    change("r1", { id: "c1" }),
    change("r2", { id: "c9", source: "revert", reverts: "c1" }),
    change("r3", { id: "c10", source: "revert", reverts: "c9" }),
  ]);
  assert.equal(state.turns[0]?.reverted, false);
});

test("a revert of an unknown change leaves the state alone", () => {
  const state = fold([change("r1", { id: "c1" })]);
  assert.equal(reduceChanges(state, change("r2", { id: "c9", source: "revert", reverts: "nope" })), state);
});

test("other events leave the state identical", () => {
  const other = { type: "session.updated", run_id: null, seq: 1, session_id: "s", ts: "t", data: {} } as unknown as ChatEvent;
  assert.equal(reduceChanges(noChanges, other), noChanges);
});

test("totals and changesLine", () => {
  assert.deepEqual(totals([file(2, 1), file(3, 0)]), { files: 2, added: 5, removed: 1 });
  assert.equal(changesLine([]), "");
  assert.equal(changesLine([file(2, 0)]), "1 file +2");
  assert.equal(changesLine([file(2, 1)]), "1 file +2 −1");
  assert.equal(changesLine([file(40, 4), file(3, 0), file(0, 0)]), "3 files +43 −4");
  assert.equal(changesLine([file(0, 5), file(0, 0)]), "2 files −5");
});

function ask(runId: string, text: string, at = "2026-01-01T00:00:00Z"): ChatMessage {
  return { id: `m-${runId}`, role: "user", text, streaming: false, at, runId };
}

test("turn cards come newest first, numbered from the oldest, with the request as title", () => {
  const state = fold([change("r1", { id: "c1" }), change("r2", { id: "c2", path: "b.py", added: 2, removed: 1 }), change("r3", { id: "c3" })]);
  const cards = turnCards(state, [ask("r1", "first"), ask("r2", "second"), ask("r3", "third")]);
  assert.deepEqual(cards.map((card) => [card.number, card.title, card.runId]), [[3, "third", "r3"], [2, "second", "r2"], [1, "first", "r1"]]);
  assert.equal(cards[1]?.line, "1 file +2 −1");
  assert.equal(cards[1]?.at, "2026-01-01T00:00:00Z");
});

test("a turn with no request in the transcript has an empty title; an undo has no card", () => {
  const state = fold([change("r1", { id: "c1" }), change("r1", { id: "u1", source: "revert", reverts: "c1" })]);
  const cards = turnCards(state, []);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.title, "");
  assert.equal(cards[0]?.at, null);
  assert.equal(cards[0]?.reverted, true);
});

test("a title is one line and cut at 80 characters", () => {
  assert.equal(cutTitle("make   the\nwait configurable"), "make the wait configurable");
  const cut = cutTitle("x".repeat(100));
  assert.equal(cut.length, 80);
  assert.ok(cut.endsWith("…"));
  assert.equal(cutTitle("y".repeat(80)).length, 80);
});
