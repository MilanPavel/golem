import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChangedFile } from "@golem/client";

import type { Press } from "./keys.ts";

import { numberDiff } from "@golem/view";
import {
  changesKeyOf,
  layoutChanges,
  openChangesManager,
  pressChanges,
  pressNoteInput,
  NO_NOTE_ROW_MESSAGE,
  type ChangesAction,
  type ChangesManagerState,
  type ChangesData,
} from "./changes-manager.ts";

const press = (name: Press["name"], input = ""): Press => ({ name, input, ctrl: false, meta: false });

function file(path: string, added: number, removed: number, status: ChangedFile["status"] = "modified"): ChangedFile {
  return { path, status, added, removed, change_ids: [], stale: false };
}

const DIFF_A = ["--- a/a.py", "+++ b/a.py", "@@ -1,2 +1,2 @@", "-x", "+y", " z", "@@ -9,2 +9,2 @@", "-p", "+q", " r", ""].join("\n");
const DIFF_B = ["--- a/b.py", "+++ b/b.py", "@@ -1 +1 @@", "-1", "+2", ""].join("\n");

function data(extra: Partial<ChangesData> = {}): ChangesData {
  return {
    files: [file("a.py", 2, 2), file("src/config.py", 3, 0, "created"), file("old.py", 0, 2, "deleted")],
    error: null,
    diffs: { "a.py": DIFF_A },
    ...extra,
  };
}

test("keys map", () => {
  assert.equal(changesKeyOf(press("up")), "up");
  assert.equal(changesKeyOf(press("down")), "down");
  assert.equal(changesKeyOf(press(null, "n")), "next-hunk");
  assert.equal(changesKeyOf(press(null, "p")), "prev-hunk");
  assert.equal(changesKeyOf(press("page-up")), "page-up");
  assert.equal(changesKeyOf(press("page-down")), "page-down");
  assert.equal(changesKeyOf(press("escape")), "back");
  assert.equal(changesKeyOf(press(null, "u")), "undo-hunk");
  assert.equal(changesKeyOf(press(null, "U")), "undo-file");
  assert.equal(changesKeyOf(press(null, "y")), "yes");
  assert.equal(changesKeyOf(press(null, "j")), "row-down");
  assert.equal(changesKeyOf(press(null, "k")), "row-up");
  assert.equal(changesKeyOf({ ...press("down"), shift: true }), "row-down");
  assert.equal(changesKeyOf({ ...press("up"), shift: true }), "row-up");
  assert.equal(changesKeyOf(press(null, "c")), "note");
  assert.equal(changesKeyOf(press(null, "x")), "remove-note");
  assert.equal(changesKeyOf(press(null, "z")), null);
  assert.equal(changesKeyOf({ ...press(null, "n"), ctrl: true }), null);
});

test("esc closes", () => {
  const pressed = pressChanges(openChangesManager(), data(), "back");
  assert.equal(pressed.state.open, false);
  assert.deepEqual(pressed.action, { kind: "close" });
});

test("moving files stops at the ends and resets hunk and offset", () => {
  let state = { ...openChangesManager(), hunk: 1, offset: 6 };
  const top = pressChanges(state, data(), "up");
  assert.equal(top.state.file, 0);
  assert.deepEqual(top.action, { kind: "none" });
  const next = pressChanges(state, data(), "down");
  assert.deepEqual({ ...next.state }, { open: true, file: 1, hunk: 0, offset: 0, row: 0, input: null, confirm: null, message: null });
  state = { ...state, file: 2 };
  assert.equal(pressChanges(state, data(), "down").state.file, 2);
});

test("load is asked once per file, only when its diff is missing", () => {
  const first = pressChanges(openChangesManager(), data(), "down");
  assert.deepEqual(first.action, { kind: "load", path: "src/config.py" });
  const loaded = data({ diffs: { "a.py": DIFF_A, "src/config.py": DIFF_B } });
  assert.deepEqual(pressChanges(openChangesManager(), loaded, "down").action, { kind: "none" });
});

test("hunk jumps land on @@ rows", () => {
  const d = data();
  const one = pressChanges(openChangesManager(), d, "next-hunk");
  assert.equal(one.state.offset, 2);
  assert.equal(one.state.hunk, 0);
  const two = pressChanges(one.state, d, "next-hunk");
  assert.equal(two.state.offset, 6);
  assert.equal(two.state.hunk, 1);
  assert.equal(pressChanges(two.state, d, "next-hunk").state, two.state);
  const back = pressChanges(two.state, d, "prev-hunk");
  assert.equal(back.state.offset, 2);
  assert.equal(pressChanges(back.state, d, "prev-hunk").state, back.state);
});

test("paging stays inside the diff", () => {
  const d = data();
  assert.equal(pressChanges(openChangesManager(), d, "page-up", 4).state.offset, 0);
  assert.equal(pressChanges(openChangesManager(), d, "page-down", 4).state.offset, 4);
  assert.equal(pressChanges(openChangesManager(), d, "page-down", 400).state.offset, 9);
});

test("layout at 120 columns puts the files beside the diff", () => {
  const rows = layoutChanges(openChangesManager(), data(), 120, 12);
  assert.equal(rows.length, 12);
  assert.equal(rows[0]?.text, "changes · 3 files +5 −4");
  assert.equal(rows[11]?.text, "↑↓ file · j/k row · n/p hunk · c note · x remove note · PgUp/Dn scroll · u undo hunk · U undo file · g commit · esc back");
  assert.equal(rows[1]?.left?.length, 28);
  assert.equal(rows[1]?.left, "M a.py                 +2 −2 ".slice(0, 28).padEnd(28));
  assert.equal(rows[1]?.leftSelected, true);
  assert.equal(rows[2]?.left?.startsWith("A src/config.py"), true);
  assert.equal(rows[3]?.left?.startsWith("D old.py"), true);
  const hunk = rows[3];
  assert.equal(hunk?.tone, "hunk");
  assert.equal(hunk?.text.length, 91);
  assert.equal(hunk?.text.endsWith("hunk 1/2"), true);
  assert.equal(rows[4]?.tone, "del");
  assert.equal(rows[5]?.tone, "add");
});

test("layout at 100 columns is still wide, at 99 it is not", () => {
  assert.notEqual(layoutChanges(openChangesManager(), data(), 100, 10)[1]?.left, null);
  assert.equal(layoutChanges(openChangesManager(), data(), 99, 10)[1]?.left, null);
});

test("layout at 60 columns names the file in the first row", () => {
  const state = { ...openChangesManager(), file: 1 };
  const loaded = data({ diffs: { "src/config.py": DIFF_B } });
  const rows = layoutChanges(state, loaded, 60, 8);
  assert.equal(rows[0]?.text, "changes · 3 files +5 −4");
  assert.equal(rows[1]?.text, "‹ 2/3 src/config.py +3 −0 ›");
  assert.equal(rows[1]?.left, null);
  assert.equal(rows[2]?.text, "▌--- a/b.py");
  assert.equal(rows[4]?.text.length, 60);
  assert.equal(rows[4]?.text.endsWith("hunk 1/1"), true);
});

test("the offset scrolls the diff and is kept inside it", () => {
  const rows = layoutChanges({ ...openChangesManager(), offset: 6, row: 6 }, data(), 120, 6);
  assert.equal(rows[1]?.tone, "hunk");
  assert.equal(rows[1]?.text.endsWith("hunk 2/2"), true);
  const past = layoutChanges({ ...openChangesManager(), offset: 99, row: 99 }, data(), 120, 6);
  assert.equal(past[past.length - 2]?.text, "▌ r");
});

test("empty, loading, and error", () => {
  const empty = layoutChanges(openChangesManager(), data({ files: [] }), 80, 6);
  assert.equal(empty[0]?.text, "changes");
  assert.equal(empty[1]?.text, "No changes yet.");
  assert.equal(empty[5]?.text, "esc back");
  assert.equal(layoutChanges(openChangesManager(), data({ files: null }), 80, 6)[1]?.text, "asking the daemon…");
  assert.equal(layoutChanges(openChangesManager(), data({ files: null, error: "no daemon" }), 80, 6)[1]?.text, "no daemon");
  const waiting = layoutChanges({ ...openChangesManager(), file: 2 }, data(), 120, 6);
  assert.equal(waiting[1]?.text, "loading the diff…");
  const failed = layoutChanges({ ...openChangesManager(), file: 2 }, data({ failed: { "old.py": "gone" } }), 120, 6);
  assert.equal(failed[1]?.text, "gone");
});

test("long paths are cut from the left", () => {
  const long = "packages/very/deep/folder/name/module.py";
  const rows = layoutChanges(openChangesManager(), data({ files: [file(long, 10, 2)], diffs: {} }), 120, 4);
  const left = rows[1]?.left ?? "";
  assert.equal(left.length, 28);
  assert.equal(left.startsWith("M …"), true);
  assert.equal(left.includes("module.py"), true);
  assert.equal(left.trimEnd().endsWith("+10 −2"), true);
});

test("u asks, and y undoes the hunk under the cursor", () => {
  const first = pressChanges(openChangesManager(), data(), "next-hunk").state;
  const second = pressChanges(first, data(), "next-hunk").state;
  const asked = pressChanges(second, data(), "undo-hunk");
  assert.deepEqual(asked.state.confirm, { kind: "hunk", path: "a.py", hunk: 1 });
  assert.deepEqual(asked.action, { kind: "none" });
  assert.match(layoutChanges(asked.state, data(), 120, 12).at(-1)?.text ?? "", /^undo hunk 2 of a\.py\? y\/n/);
  const yes = pressChanges(asked.state, data(), "yes");
  assert.deepEqual(yes.action, { kind: "revert", target: { kind: "hunk", path: "a.py", hunk: 1 } });
  assert.equal(yes.state.confirm, null);
});

test("U asks, and y undoes the selected file", () => {
  const state = pressChanges(openChangesManager(), data(), "down").state;
  const asked = pressChanges(state, data(), "undo-file");
  assert.deepEqual(asked.state.confirm, { kind: "file", path: "src/config.py" });
  assert.deepEqual(pressChanges(asked.state, data(), "yes").action, {
    kind: "revert",
    target: { kind: "file", path: "src/config.py" },
  });
});

test("n, esc, or any other key drops the question and sends nothing", () => {
  const asked = pressChanges(openChangesManager(), data(), "undo-file").state;
  for (const key of ["next-hunk", "back", "up", "undo-file"] as const) {
    const pressed = pressChanges(asked, data(), key);
    assert.deepEqual(pressed.action, { kind: "none" });
    assert.equal(pressed.state.confirm, null);
    assert.equal(pressed.state.open, true);
  }
});

test("a hunk undo needs a loaded diff with a hunk", () => {
  const state = pressChanges(openChangesManager(), data({ diffs: {} }), "undo-hunk");
  assert.equal(state.state.confirm, null);
});

test("while golem runs, u and U only say to wait", () => {
  for (const key of ["undo-hunk", "undo-file"] as const) {
    const pressed = pressChanges(openChangesManager(), data(), key, 10, true);
    assert.equal(pressed.state.confirm, null);
    assert.equal(pressed.state.message, "Wait for golem to finish.");
    assert.equal(layoutChanges(pressed.state, data(), 120, 12).at(-1)?.text, "Wait for golem to finish.");
    assert.equal(pressChanges(pressed.state, data(), "down").state.message, null);
  }
});

test("the hint lists the undo keys", () => {
  const hint = layoutChanges(openChangesManager(), data(), 120, 12).at(-1)?.text ?? "";
  assert.match(hint, /u undo hunk · U undo file/);
});

test("a folder too big to watch says so, wrapped, with no files and with some", () => {
  const empty = layoutChanges(openChangesManager(), data({ files: [], shell: "off" }), 60, 8);
  assert.equal(empty[1]?.text, "No changes yet.");
  assert.equal(empty[2]?.text, "Changes made by shell commands are not listed: this folder");
  assert.equal(empty[3]?.text, "is too big to watch and is not a git repository.");
  const listed = layoutChanges(openChangesManager(), data({ shell: "off" }), 120, 8);
  assert.equal(listed[1]?.text, "Changes made by shell commands are not listed: this folder is too big to watch and is not a git repository.");
  assert.equal(layoutChanges(openChangesManager(), data({ files: [], shell: "files" }), 60, 8)[2]?.text, "");
});

function typeIn(state: ChangesManagerState, text: string): ChangesManagerState {
  let next = state;
  for (const char of text) {
    next = pressNoteInput(next, press(null, char)).state;
  }
  return next;
}

// DIFF_A rows: 0 --- · 1 +++ · 2 @@ · 3 -x · 4 +y · 5 " z" · 6 @@ · 7 -p · 8 +q · 9 " r"
function onRow(row: number): ChangesManagerState {
  return { ...openChangesManager(), row };
}

test("j and k move the cursor one row and stay inside the diff", () => {
  const d = data();
  let state = openChangesManager();
  assert.equal(pressChanges(state, d, "row-up").state.row, 0);
  state = pressChanges(state, d, "row-down").state;
  assert.equal(state.row, 1);
  state = pressChanges(state, d, "row-up").state;
  assert.equal(state.row, 0);
  assert.equal(pressChanges(onRow(9), d, "row-down").state.row, 9);
  assert.equal(pressChanges(onRow(9), d, "row-down").state.hunk, 1);
});

test("the window follows the cursor down and up", () => {
  const d = data();
  const down = pressChanges({ ...onRow(3), offset: 0 }, d, "row-down", 4).state;
  assert.equal(down.row, 4);
  assert.equal(down.offset, 1);
  const up = pressChanges({ ...onRow(3), offset: 3 }, d, "row-up", 4).state;
  assert.deepEqual([up.row, up.offset], [2, 2]);
});

test("n and p put the cursor on the first changed row of a hunk", () => {
  const d = data();
  const one = pressChanges(openChangesManager(), d, "next-hunk").state;
  assert.deepEqual([one.row, one.offset], [3, 2]);
  const two = pressChanges(one, d, "next-hunk").state;
  assert.deepEqual([two.row, two.offset, two.hunk], [7, 6, 1]);
  // From the middle of a hunk, p goes to the start of this one first.
  const moved = pressChanges(two, d, "row-down").state;
  assert.equal(pressChanges(moved, d, "prev-hunk").state.row, 7);
  assert.equal(pressChanges(two, d, "prev-hunk").state.row, 3);
});

test("the cursor is drawn as a block in the first column of the diff, and nowhere else", () => {
  const rows = layoutChanges(onRow(4), data(), 120, 12);
  assert.equal(rows[5]?.text.startsWith("▌+y"), true);
  assert.equal(rows.filter((row) => row.text.startsWith("▌")).length, 1);
  assert.equal(rows[4]?.text.startsWith(" -x"), true);
  // It stays on screen when the offset says otherwise.
  const far = layoutChanges({ ...openChangesManager(), row: 9, offset: 0 }, data(), 120, 6);
  assert.equal(far.some((row) => row.text === "▌ r"), true);
});

test("c opens a note on an added, removed or unchanged row, with the path, line, side and code", () => {
  const d = data();
  for (const [row, line, side, code] of [
    [3, 1, "old", "x"],
    [4, 1, "new", "y"],
    [5, 2, "new", "z"],
    [8, 9, "new", "q"],
  ] as const) {
    const opened = pressChanges(onRow(row), d, "note").state;
    assert.deepEqual(opened.input, { path: "a.py", line, side, code, text: "" });
  }
  const typed = typeIn(pressChanges(onRow(4), d, "note").state, "use y");
  assert.equal(layoutChanges(typed, d, 120, 12).at(-1)?.text, "note on a.py:1 › use y_");
  const saved = pressNoteInput(typed, press("return"));
  assert.deepEqual(saved.action, { kind: "add-note", note: { path: "a.py", line: 1, side: "new", code: "y", text: "use y" } });
  assert.equal(saved.state.input, null);
});

test("backspace edits the note, escape drops it, and an empty note is not saved", () => {
  const d = data();
  const opened = typeIn(pressChanges(onRow(4), d, "note").state, "abc");
  assert.equal(pressNoteInput(opened, press("backspace")).state.input?.text, "ab");
  const dropped = pressNoteInput(opened, press("escape"));
  assert.equal(dropped.state.input, null);
  assert.deepEqual(dropped.action, { kind: "none" });
  const blank = pressNoteInput(typeIn(pressChanges(onRow(4), d, "note").state, "  "), press("return"));
  assert.deepEqual(blank.action, { kind: "none" });
  assert.equal(blank.state.input, null);
});

test("hunk, file header and out-of-range rows refuse a note", () => {
  const d = data();
  for (const row of [0, 1, 2, 6]) {
    const pressed = pressChanges(onRow(row), d, "note");
    assert.equal(pressed.state.input, null);
    assert.equal(pressed.state.message, NO_NOTE_ROW_MESSAGE);
  }
  assert.equal(numberDiff([]).length, 0);
});

test("a row with a note shows the mark at its right end and the note text dim on the next row", () => {
  const notes = [{ id: "n1", path: "a.py", line: 1, side: "new" as const, code: "y", text: "rename it" }];
  const rows = layoutChanges(openChangesManager(), data({ notes }), 60, 14);
  const at = rows.findIndex((row) => row.text.startsWith(" +y"));
  assert.equal(rows[at]?.text.endsWith(" 💬"), true);
  assert.equal(rows[at + 1]?.text.trim(), "rename it");
  assert.equal(rows[at + 1]?.dim, true);
  // The old side of line 1 has no note.
  assert.equal(rows[at - 1]?.text.includes("💬"), false);
});

test("x removes the notes on the cursor row, and does nothing on a row without one", () => {
  const notes = [
    { id: "n1", path: "a.py", line: 1, side: "new" as const, code: "y", text: "one" },
    { id: "n2", path: "a.py", line: 1, side: "new" as const, code: "y", text: "two" },
    { id: "n3", path: "a.py", line: 1, side: "old" as const, code: "x", text: "other side" },
    { id: "n4", path: "b.py", line: 1, side: "new" as const, code: "y", text: "other file" },
  ];
  const d = data({ notes });
  const removed: ChangesAction = pressChanges(onRow(4), d, "remove-note").action;
  assert.deepEqual(removed, { kind: "remove-notes", ids: ["n1", "n2"] });
  assert.deepEqual(pressChanges(onRow(3), d, "remove-note").action, { kind: "remove-notes", ids: ["n3"] });
  assert.deepEqual(pressChanges(onRow(5), d, "remove-note").action, { kind: "none" });
  assert.deepEqual(pressChanges(onRow(2), d, "remove-note").action, { kind: "none" });
});

test("the hint drops the least needed keys on a narrow screen and keeps commit and back", () => {
  const wide = layoutChanges(openChangesManager(), data(), 120, 12).at(-1)?.text ?? "";
  assert.match(wide, /j\/k row · n\/p hunk · c note · x remove note/);
  const narrow = layoutChanges(openChangesManager(), data(), 60, 12).at(-1)?.text ?? "";
  assert.equal(narrow.length <= 60, true);
  assert.match(narrow, /g commit · esc back$/);
});
