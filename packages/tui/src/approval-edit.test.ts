import assert from "node:assert/strict";
import { test } from "node:test";

import { argsEditLines, editedArgs, liveArgsEdit, parseArgs, startArgsEdit } from "./approval-edit.ts";
import type { PendingApproval } from "@golem/view";

const approval: PendingApproval = {
  callId: "c1",
  name: "edit_file",
  args: { path: "a.py", old_string: "two", new_string: "2" },
  source: "built-in default",
  diff: null,
};

test("the editor starts with the arguments as indented JSON and the cursor at the end", () => {
  const edit = startArgsEdit(approval);
  assert.equal(edit.draft.text, JSON.stringify(approval.args, null, 2));
  assert.equal(edit.draft.cursor, edit.draft.text.length);
  assert.equal(edit.error, null);
});

test("only one JSON object is accepted", () => {
  assert.deepEqual(parseArgs('{"path": "b.py"}'), { ok: true, args: { path: "b.py" } });
  for (const text of ["[1]", "null", '"x"', "{"]) {
    assert.equal(parseArgs(text).ok, false, text);
  }
});

test("an edit for a call that no longer waits is dropped", () => {
  const edit = startArgsEdit(approval);
  assert.equal(liveArgsEdit(edit, approval), edit);
  assert.equal(liveArgsEdit(edit, { ...approval, callId: "c2" }), null);
  assert.equal(liveArgsEdit(edit, null), null);
});

test("the band shows the error in place of the rule", () => {
  const edit = { ...startArgsEdit(approval), error: "invalid arguments for edit_file: old_string" };
  const lines = argsEditLines(approval, edit, 80);
  assert.equal(lines.length, 3);
  assert.equal(lines[1]?.text, "invalid arguments for edit_file: old_string");
  assert.equal(lines[1]?.tone, "del");
});

test("arguments that were not changed are not sent as edited", () => {
  assert.equal(editedArgs(approval, { ...approval.args }), null);
  assert.deepEqual(editedArgs(approval, { path: "b.py" }), { path: "b.py" });
});
