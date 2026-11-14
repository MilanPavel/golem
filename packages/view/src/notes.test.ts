import assert from "node:assert/strict";
import { test } from "node:test";

import { addNote, editNote, noNotes, notesChip, notesFor, removeNote, withNotes, type NotesState } from "./notes.ts";

const fetchNote = { path: "src/fetch.py", line: 64, side: "new", code: "    wait = 0.5", text: "read this from settings, and cap it at 30 s" } as const;
const testNote = { path: "tests/test_fetch.py", line: 12, side: "new", code: "def test_retries_three_times():", text: "also test the 4th failure raises" } as const;

function two(): NotesState {
  return addNote(addNote(noNotes, fetchNote), testNote);
}

test("a note is added with its own id, edited, and removed", () => {
  const both = two();
  const [first, second] = both.notes;
  assert.notEqual(first?.id, second?.id);
  const edited = editNote(both, first?.id ?? "", "new text");
  assert.equal(edited.notes[0]?.text, "new text");
  assert.equal(removeNote(edited, first?.id ?? "").notes.length, 1);
  assert.equal(noNotes.notes.length, 0);
});

test("an id is not reused after a removal", () => {
  const one = addNote(noNotes, fetchNote);
  const again = addNote(removeNote(one, one.notes[0]?.id ?? ""), fetchNote);
  assert.notEqual(again.notes[0]?.id, one.notes[0]?.id);
});

test("editing to empty text removes the note", () => {
  const one = addNote(noNotes, fetchNote);
  assert.equal(editNote(one, one.notes[0]?.id ?? "", "").notes.length, 0);
});

test("notes of a file come back by line", () => {
  let state = addNote(noNotes, { ...fetchNote, line: 90 });
  state = addNote(state, testNote);
  state = addNote(state, { ...fetchNote, line: 5 });
  assert.deepEqual(
    notesFor(state, "src/fetch.py").map((note) => note.line),
    [5, 90],
  );
  assert.deepEqual(notesFor(state, "none.py"), []);
});

test("the chip counts the notes, and is null for none", () => {
  assert.equal(notesChip(noNotes), null);
  assert.equal(notesChip(addNote(noNotes, fetchNote)), "1 note");
  assert.equal(notesChip(addNote(two(), fetchNote)), "3 notes");
});

test("the message is the notes and then the text, exactly", () => {
  const expected = [
    "Review notes:",
    "",
    "1. src/fetch.py:64",
    "   +     wait = 0.5",
    "   read this from settings, and cap it at 30 s",
    "",
    "2. tests/test_fetch.py:12",
    "   + def test_retries_three_times():",
    "   also test the 4th failure raises",
    "",
    "and add a test for the cap",
  ].join("\n");
  assert.equal(withNotes(two(), "and add a test for the cap"), expected);
});

test("paths are ordered by their first note, then lines", () => {
  const state = addNote(addNote(addNote(noNotes, testNote), fetchNote), { ...testNote, line: 3, text: "early" });
  const out = withNotes(state, "");
  assert.ok(out.indexOf("tests/test_fetch.py:3") < out.indexOf("tests/test_fetch.py:12"));
  assert.ok(out.indexOf("tests/test_fetch.py:12") < out.indexOf("src/fetch.py:64"));
});

test("with no notes the text is unchanged", () => {
  assert.equal(withNotes(noNotes, "hello\n"), "hello\n");
});

test("notes with empty text end the message after the last note", () => {
  const out = withNotes(addNote(noNotes, { ...fetchNote, side: "old" }), "");
  assert.equal(out, "Review notes:\n\n1. src/fetch.py:64\n   -     wait = 0.5\n   read this from settings, and cap it at 30 s");
});

test("a note of several lines keeps them, each indented", () => {
  const out = withNotes(addNote(noNotes, { ...fetchNote, text: "one\ntwo" }), "");
  assert.ok(out.endsWith("\n   one\n   two"));
});

test("a long code row is cut at 200 characters", () => {
  const out = withNotes(addNote(noNotes, { ...fetchNote, code: "x".repeat(300) }), "");
  assert.ok(out.includes(`   + ${"x".repeat(200)}\n`));
  assert.ok(!out.includes("x".repeat(201)));
});
