import assert from "node:assert/strict";
import { test } from "node:test";

import { numberDiff, parseDiff } from "./diff.ts";

const nums = (diff: string) => numberDiff(parseDiff(diff)).map((line) => [line.old, line.new]);

test("numberDiff numbers two hunks from their headers", () => {
  const diff = "--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -10,2 +10,3 @@\n d\n+e\n f\n";
  assert.deepEqual(nums(diff), [
    [null, null],
    [null, null],
    [null, null],
    [1, 1],
    [2, null],
    [null, 2],
    [3, 3],
    [null, null],
    [10, 10],
    [null, 11],
    [11, 12],
  ]);
});

test("numberDiff numbers a new file from one", () => {
  assert.deepEqual(nums("--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+a\n+b\n"), [
    [null, null],
    [null, null],
    [null, null],
    [null, 1],
    [null, 2],
  ]);
});

test("numberDiff numbers deletions only, and gives a no-newline note none", () => {
  assert.deepEqual(nums("@@ -4,2 +3,0 @@\n-a\n-b\n\\ No newline at end of file\n"), [
    [null, null],
    [4, null],
    [5, null],
    [null, null],
  ]);
});

test("numberDiff gives text with no hunk header no numbers", () => {
  assert.deepEqual(nums("+a\n b\n"), [
    [null, null],
    [null, null],
  ]);
});

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
