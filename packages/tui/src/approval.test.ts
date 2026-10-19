import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalLines } from "./approval.ts";

test("the approval band names the call, the rule, and the keys", () => {
  const lines = approvalLines(
    { callId: "c1", name: "read_file", args: { path: "notes.txt" }, source: "~/.golem/config.toml rule 1" },
    80,
  );
  assert.deepEqual(
    lines.map((line) => line.text),
    [
      "Allow read_file notes.txt?",
      "asked by ~/.golem/config.toml rule 1",
      "a allow once · s allow for this session · d deny",
    ],
  );
  const narrow = approvalLines({ callId: "c1", name: "grep", args: { pattern: "x".repeat(50) }, source: "s" }, 20);
  assert.equal(narrow[0]?.text.length, 20);
  assert.ok(narrow[0]?.text.endsWith("…"));
});
