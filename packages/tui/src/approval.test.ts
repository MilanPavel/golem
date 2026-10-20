import assert from "node:assert/strict";
import { test } from "node:test";

import { APPROVAL_ROWS, approvalLines, approvalRows } from "./approval.ts";
import type { PendingApproval } from "./chat-state.ts";

const DIFF = "--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n";

function pending(fields: Partial<PendingApproval>): PendingApproval {
  return { callId: "c1", name: "edit_file", args: { path: "a.py" }, source: "built-in default", diff: null, ...fields };
}

test("the approval band names the call, the rule, and the keys", () => {
  const lines = approvalLines(
    pending({ name: "read_file", args: { path: "notes.txt" }, source: "~/.golem/config.toml rule 1" }),
    80,
  );
  assert.deepEqual(
    lines.map((line) => line.text),
    [
      "Allow read_file notes.txt?",
      "asked by ~/.golem/config.toml rule 1",
      "a once · s this session · w always (saves a rule) · d deny",
    ],
  );
  const narrow = approvalLines(pending({ name: "grep", args: { pattern: "x".repeat(50) } }), 20);
  assert.equal(narrow[0]?.text.length, 20);
  assert.ok(narrow[0]?.text.endsWith("…"));
});

test("a diff sits between the question and the rule, with a tone per row", () => {
  const approval = pending({ diff: DIFF });
  assert.equal(approvalRows(approval, 40), APPROVAL_ROWS + 6);
  const lines = approvalLines(approval, 80, approvalRows(approval, 40));
  assert.deepEqual(
    lines.map((line) => line.tone ?? null),
    ["question", "meta", "meta", "hunk", "context", "del", "add", null, null],
  );
});

test("a long diff gets at most half the screen and scrolls by offset", () => {
  const approval = pending({ diff: DIFF });
  const rows = approvalRows(approval, 12);
  assert.equal(rows, 6);
  const lines = approvalLines(approval, 80, rows, 3);
  assert.deepEqual(
    lines.slice(1, 4).map((line) => line.text),
    [" one", "-two", "+TWO"],
  );
  assert.ok(lines.at(-1)?.text.endsWith("↑↓ scroll"));
  assert.ok(lines.at(-2)?.text.endsWith("diff 6 lines"));
});
