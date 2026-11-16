import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";
import { noChanges, reduceChanges, type ChangesState } from "@golem/view";

import {
  foldPrompts,
  nextUndo,
  noPrompts,
  openUndo,
  pressUndo,
  undoAnswered,
  undoKeyOf,
  undoLines,
  undoneNotice,
  type Prompts,
} from "./undo.ts";

function event(type: string, run: string | null, data: Record<string, unknown>): ChatEvent {
  return { type, run_id: run, seq: 1, session_id: "s", ts: "2026-01-01T00:00:00Z", data } as unknown as ChatEvent;
}

function user(text: string): ChatEvent {
  return event("message.completed", "r", { message_id: `m_${text}`, role: "user", text });
}

function edit(run: string, id: string, path: string, over: Record<string, unknown> = {}): ChatEvent {
  return event("file.changed", run, { change_id: id, path, status: "modified", added: 1, removed: 0, source: "tool", ...over });
}

function fold(events: ChatEvent[]): { changes: ChangesState; prompts: Prompts } {
  return {
    changes: events.reduce(reduceChanges, noChanges),
    prompts: events.reduce(foldPrompts, noPrompts),
  };
}

const TURNS = [
  user("first"),
  event("run.started", "r1", {}),
  edit("r1", "c1", "a.py"),
  user("make the wait configurable"),
  event("run.started", "r2", {}),
  edit("r2", "c2", "src/fetch.py"),
  edit("r2", "c3", "src/config.py"),
  user("just talk"),
  event("run.started", "r3", {}),
];

test("picks the newest turn that changed files, with its words and number", () => {
  const { changes, prompts } = fold(TURNS);
  assert.deepEqual(nextUndo(changes, prompts), {
    runId: "r2",
    number: 2,
    text: "make the wait configurable",
    paths: ["src/fetch.py", "src/config.py"],
  });
});

test("a turn that is undone is skipped, so /undo goes one turn further back", () => {
  const { changes, prompts } = fold([...TURNS, edit("r2", "c4", "src/fetch.py", { source: "revert", reverts: "c2" })]);
  assert.equal(nextUndo(changes, prompts)?.runId, "r1");
  const both = fold([
    ...TURNS,
    edit("r2", "c4", "src/fetch.py", { source: "revert", reverts: "c2" }),
    edit("r1", "c5", "a.py", { source: "revert", reverts: "c1" }),
  ]);
  assert.equal(nextUndo(both.changes, both.prompts), null);
});

test("no changes: nothing to undo", () => {
  assert.equal(nextUndo(noChanges, noPrompts), null);
});

test("the band shows the question, the files, and the keys", () => {
  const { changes, prompts } = fold(TURNS);
  const band = openUndo(nextUndo(changes, prompts)!);
  assert.deepEqual(
    undoLines(band, 80, 5).map((line) => line.text),
    ['undo turn 2 "make the wait configurable"', "  src/fetch.py", "  src/config.py", " enter undo · esc cancel"],
  );
});

test("a long list is cut with a count", () => {
  const offer = { runId: "r", number: 1, text: "x", paths: ["a", "b", "c", "d", "e"] };
  const lines = undoLines(openUndo(offer), 80, 5).map((line) => line.text);
  assert.equal(lines.length, 5);
  assert.equal(lines[3], "  … and 3 more");
});

test("enter sends the run, and a second enter while it is out does nothing", () => {
  const band = openUndo({ runId: "r2", number: 2, text: "", paths: ["a"] });
  const pressed = pressUndo(band, "enter");
  assert.deepEqual(pressed.action, { kind: "revert", runId: "r2", force: false });
  assert.equal(pressed.band?.working, true);
  assert.deepEqual(pressUndo(pressed.band!, "enter").action, { kind: "none" });
});

test("esc closes without a call", () => {
  const pressed = pressUndo(openUndo({ runId: "r", number: 1, text: "", paths: ["a"] }), "escape");
  assert.equal(pressed.band, null);
  assert.deepEqual(pressed.action, { kind: "none" });
});

test("a conflict asks a second question: o repeats with force, k closes", () => {
  const sent = pressUndo(openUndo({ runId: "r", number: 1, text: "t", paths: ["a", "b"] }), "enter").band!;
  const answered = undoAnswered(sent, { reverted: ["a"], conflicts: [{ path: "b", reason: "changed_on_disk" }] });
  assert.equal(answered.notice, null);
  const second = answered.band!;
  assert.deepEqual(
    undoLines(second, 80, 5).map((line) => line.text),
    ['undo turn 1 "t"', "  b  changed since golem wrote it", " o overwrite · k keep mine"],
  );
  assert.deepEqual(pressUndo(second, "enter").action, { kind: "none" });
  assert.deepEqual(pressUndo(second, "overwrite").action, { kind: "revert", runId: "r", force: true });
  assert.equal(pressUndo(second, "keep").band, null);
  const done = undoAnswered(pressUndo(second, "overwrite").band!, { reverted: ["b"], conflicts: [] });
  assert.equal(done.band, null);
  assert.equal(done.notice, undoneNotice(2));
});

test("o and k do nothing before a conflict", () => {
  const band = openUndo({ runId: "r", number: 1, text: "", paths: ["a"] });
  assert.deepEqual(pressUndo(band, "overwrite"), { band, action: { kind: "none" } });
  assert.deepEqual(pressUndo(band, "keep"), { band, action: { kind: "none" } });
});

test("the notice counts files", () => {
  assert.equal(undoneNotice(2), "Undone: 2 files put back. /undo again goes one turn further back.");
  assert.equal(undoneNotice(1), "Undone: 1 file put back. /undo again goes one turn further back.");
});

test("keys", () => {
  const press = (name: string | null, input = "") => ({ name, input, ctrl: false, meta: false });
  assert.equal(undoKeyOf(press("return")), "enter");
  assert.equal(undoKeyOf(press("escape")), "escape");
  assert.equal(undoKeyOf(press(null, "o")), "overwrite");
  assert.equal(undoKeyOf(press(null, "k")), "keep");
  assert.equal(undoKeyOf(press(null, "x")), null);
});
