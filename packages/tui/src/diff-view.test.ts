import assert from "node:assert/strict";
import { test } from "node:test";

import { clampDiffOffset, diffWindow, moveDiffOffset, parseDiff } from "./diff-view.ts";

test("arrows move a line, Page keys a page, inside the diff", () => {
  assert.equal(moveDiffOffset(0, "down", true, 20, 5), 1);
  assert.equal(moveDiffOffset(0, "down", false, 20, 5), 4);
  assert.equal(moveDiffOffset(14, "down", false, 20, 5), 15);
  assert.equal(moveDiffOffset(2, "up", false, 20, 5), 0);
  assert.equal(moveDiffOffset(3, "end", false, 20, 5), 15);
});

test("each row of a unified diff gets its tone", () => {
  const lines = parseDiff("--- /dev/null\n+++ b/n.md\n@@ -0,0 +1 @@\n+hi\n\\ No newline at end of file\n");
  assert.deepEqual(
    lines.map((line) => line.tone),
    ["meta", "meta", "hunk", "add", "meta"],
  );
  assert.deepEqual(parseDiff(""), []);
});

test("tabs become spaces and long rows are cut to the width", () => {
  const [line] = diffWindow(parseDiff("+\tx = 1234567890\n"), 0, 1, 10);
  assert.equal(line?.text, "+    x = …");
});

test("the window never scrolls past the end", () => {
  assert.equal(clampDiffOffset(10, 6, 4), 2);
  assert.equal(clampDiffOffset(-3, 6, 4), 0);
  assert.equal(clampDiffOffset(1, 3, 4), 0);
  const lines = parseDiff("a\nb\nc\nd\n");
  assert.deepEqual(
    diffWindow(lines, 9, 2, 80).map((line) => line.text),
    ["c", "d"],
  );
});

test("escapes in the file cannot drive the terminal, and hunk lines keep their tone", () => {
  const lines = parseDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- old\n++x\x1b[2J\r\n");
  assert.deepEqual(
    lines.map((line) => line.tone),
    ["meta", "meta", "hunk", "del", "add"],
  );
  assert.equal(lines[4]?.text, "++x␛[2J�");
});
