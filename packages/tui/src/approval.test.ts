import assert from "node:assert/strict";
import { test } from "node:test";

import { APPROVAL_ROWS, approvalLines, approvalRows } from "./approval.ts";
import type { ChatEvent } from "@golem/client";
import { emptyChat, reduceChat, type PendingApproval } from "@golem/view";

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
      "a once · s this session · w always (saves a rule) · e edit · d deny",
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

test("attaching to a waiting headless session replays into the approval band", () => {
  const base = { session_id: "s_h", run_id: "r1", ts: "2026-11-17T08:00:00Z" } as const;
  const replay = [
    { ...base, seq: 1, type: "run.started", data: {} },
    { ...base, seq: 2, type: "message.started", data: { message_id: "m1", role: "assistant" } },
    { ...base, seq: 3, type: "message.completed", data: { message_id: "m1", role: "assistant", text: "" } },
    { ...base, seq: 4, type: "tool.requested", data: { call_id: "c1", message_id: "m1", name: "edit_file", args: { path: "a.py" } } },
    { ...base, seq: 5, type: "approval.needed", data: { call_id: "c1", name: "edit_file", args: { path: "a.py" }, source: "built-in default", subject: "a.py" } },
  ] as unknown as ChatEvent[];
  const state = replay.reduce(reduceChat, emptyChat);
  assert.ok(state.approval !== null);
  assert.equal(approvalLines(state.approval, 80)[0]?.text, "Allow edit_file a.py?");
});
