import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDiff } from "./diff.ts";

test("each row of a unified diff gets its tone", () => {
  const lines = parseDiff("--- /dev/null\n+++ b/n.md\n@@ -0,0 +1 @@\n+hi\n\\ No newline at end of file\n");
  assert.deepEqual(
    lines.map((line) => line.tone),
    ["meta", "meta", "hunk", "add", "meta"],
  );
  assert.deepEqual(parseDiff(""), []);
});

test("tabs become spaces", () => {
  assert.equal(parseDiff("+\tx\n")[0]?.text, "+    x");
});

test("escapes in the file are made visible, and hunk lines keep their tone", () => {
  const lines = parseDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- old\n++x\x1b[2J\r\n");
  assert.deepEqual(
    lines.map((line) => line.tone),
    ["meta", "meta", "hunk", "del", "add"],
  );
  assert.equal(lines[4]?.text, "++x␛[2J�");
});
