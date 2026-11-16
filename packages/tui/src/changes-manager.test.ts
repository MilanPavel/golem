import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChangedFile } from "@golem/client";

import type { Press } from "./keys.ts";

import {
  changesKeyOf,
  layoutChanges,
  openChangesManager,
  pressChanges,
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
  assert.equal(changesKeyOf(press(null, "x")), null);
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
  assert.deepEqual({ ...next.state }, { open: true, file: 1, hunk: 0, offset: 0 });
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
  assert.equal(rows[11]?.text, "↑↓ file · n/p hunk · PgUp/PgDn scroll · g commit · esc back");
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
  assert.equal(rows[2]?.text, "--- a/b.py");
  assert.equal(rows[4]?.text.length, 60);
  assert.equal(rows[4]?.text.endsWith("hunk 1/1"), true);
});

test("the offset scrolls the diff and is kept inside it", () => {
  const rows = layoutChanges({ ...openChangesManager(), offset: 6 }, data(), 120, 6);
  assert.equal(rows[1]?.tone, "hunk");
  assert.equal(rows[1]?.text.endsWith("hunk 2/2"), true);
  const past = layoutChanges({ ...openChangesManager(), offset: 99 }, data(), 120, 6);
  assert.equal(past[past.length - 2]?.text.trim(), "r");
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
