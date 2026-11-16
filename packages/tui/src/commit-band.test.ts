import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChangedFile } from "@golem/client";

import { layoutChanges, openChangesManager, pressChanges } from "./changes-manager.ts";
import {
  commitKeyOf,
  commitRefused,
  layoutCommitBand,
  openCommitBand,
  pressCommit,
  suggestionArrived,
  suggestionFailed,
  type CommitBand,
} from "./commit-band.ts";
import type { Press } from "./keys.ts";

const press = (name: Press["name"], input = ""): Press => ({ name, input, ctrl: false, meta: false });

const band = (extra: Partial<CommitBand> = {}): CommitBand => ({
  ...openCommitBand({ branch: "main", paths: ["a.py", "b.py", "c.py"] }),
  ...extra,
});

function type(start: CommitBand, text: string): CommitBand {
  let current = start;
  for (const letter of text) {
    const key = commitKeyOf(press(null, letter));
    assert.ok(key !== null);
    current = pressCommit(current, key, false).band;
  }
  return current;
}

test("the band rows: title, the note that the person commits, the message, the keys", () => {
  const rows = layoutCommitBand(band({ message: "Fix the clamp", suggesting: false }), 80).map((row) => row.text);
  assert.deepEqual(rows, [
    "commit 3 files on main",
    "you commit with your own git and hooks · nothing is pushed",
    "› Fix the clamp▏",
    "enter commit · ctrl+r suggest again · esc",
  ]);
});

test("while the suggestion is on its way the message row says so", () => {
  const rows = layoutCommitBand(band(), 80).map((row) => row.text);
  assert.equal(rows[2], "› Suggesting…");
});

test("a message with a body shows on one line", () => {
  const rows = layoutCommitBand(band({ message: "Subject\n\nBody", suggesting: false }), 80).map((row) => row.text);
  assert.equal(rows[2], "› Subject ⏎  ⏎ Body▏");
});

test("g in the review screen asks for the band, and the band replaces the key hint", () => {
  const files: ChangedFile[] = [{ path: "a.py", status: "modified", added: 1, removed: 0, change_ids: [], stale: false }];
  const data = { files, error: null, diffs: {} };
  assert.deepEqual(pressChanges(openChangesManager(), data, "commit").action, { kind: "commit-info" });
  const plain = layoutChanges(openChangesManager(), data, 80, 12);
  assert.ok(plain.at(-1)?.text.includes("g commit"));
  const shown = layoutChanges({ ...openChangesManager(), commit: band({ suggesting: false, message: "x" }) }, data, 80, 12);
  assert.equal(shown.length, 12);
  assert.equal(shown.at(-1)?.text, "enter commit · ctrl+r suggest again · esc");
  assert.equal(shown.at(-4)?.text, "commit 3 files on main");
});

test("enter sends the message, once", () => {
  const typed = type(band({ suggesting: false }), "Fix it");
  const first = pressCommit(typed, "enter", false);
  assert.deepEqual(first.action, { kind: "commit", message: "Fix it" });
  assert.equal(first.band.committing, true);
  assert.deepEqual(pressCommit(first.band, "enter", false).action, { kind: "none" });
});

test("enter with no message sends nothing", () => {
  assert.deepEqual(pressCommit(band({ suggesting: false }), "enter", false).action, { kind: "none" });
});

test("enter during a run sends nothing and says why", () => {
  const typed = type(band({ suggesting: false }), "Fix it");
  const pressed = pressCommit(typed, "enter", true);
  assert.deepEqual(pressed.action, { kind: "none" });
  assert.deepEqual(pressed.band.failure, ["a run is active: commit when it ends"]);
});

test("ctrl+r asks again, and esc closes", () => {
  const typed = type(band({ suggesting: false }), "ab");
  assert.deepEqual(pressCommit(typed, "again", false).action, { kind: "suggest", edits: 2 });
  assert.deepEqual(pressCommit(typed, "back", false).action, { kind: "close" });
  assert.equal(commitKeyOf(press("ctrl-r")), "again");
});

test("a suggestion fills an empty message and never replaces typed text", () => {
  assert.equal(suggestionArrived(band(), "From the model").message, "From the model");
  const typed = type(band(), "mine");
  assert.equal(suggestionArrived(typed, "From the model").message, "mine");
  assert.equal(suggestionArrived(typed, "From the model").suggesting, false);
  assert.equal(suggestionFailed(typed).suggesting, false);
});

test("an answer to suggest again replaces the message only if nothing was typed since", () => {
  const typed = type(band({ suggesting: false }), "mine");
  assert.equal(suggestionArrived(typed, "New", typed.edits).message, "New");
  assert.equal(suggestionArrived(type(typed, "!"), "New", typed.edits).message, "mine!");
});

test("a refused commit shows the last six lines of git's output and keeps the band", () => {
  const output = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join("\n");
  const refused = commitRefused(band({ committing: true, message: "x" }), output);
  assert.equal(refused.committing, false);
  assert.deepEqual(refused.failure, ["line 4", "line 5", "line 6", "line 7", "line 8", "line 9"]);
  const rows = layoutCommitBand(refused, 80);
  assert.equal(rows.filter((row) => row.tone === "del").length, 6);
  assert.equal(rows.length, 4 + 6);
});

test("editing keys", () => {
  const typed = type(band({ suggesting: false }), "héllo");
  assert.equal(pressCommit(typed, "delete", false).band.message, "héll");
  assert.equal(pressCommit(typed, "clear", false).band.message, "");
});
