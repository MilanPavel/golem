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

import { diffCounts, diffExcerpt } from "./diff.ts";

const excerptOf = (diff: string, rows: number) => diffExcerpt(parseDiff(diff), rows);

const HEAD = "--- a/x.py\n+++ b/x.py\n";

test("a short diff fits and shows no more", () => {
  const excerpt = excerptOf(`${HEAD}@@ -1,3 +1,3 @@\n a\n-b\n+c\n d\n`, 10);
  assert.deepEqual(
    excerpt.lines.map((line) => line.text),
    [" a", "-b", "+c", " d"],
  );
  assert.equal(excerpt.more, 0);
});

test("a long diff is cut, starts one context row before the first change, and counts the rest", () => {
  const body = ["c1", "c2", "c3", "c4"].map((row) => ` ${row}`).join("\n");
  const adds = Array.from({ length: 12 }, (_, index) => `+n${index}`).join("\n");
  const excerpt = excerptOf(`${HEAD}@@ -1,4 +1,16 @@\n${body}\n${adds}\n`, 5);
  assert.deepEqual(
    excerpt.lines.map((line) => line.text),
    [" c4", "+n0", "+n1", "+n2", "+n3"],
  );
  assert.equal(excerpt.more, 8);
});

test("a new file has only added rows", () => {
  const excerpt = excerptOf("--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+a\n+b\n", 10);
  assert.equal(excerpt.lines.length, 2);
  assert.deepEqual(diffCounts(parseDiff("--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+a\n+b\n")), {
    added: 2,
    deleted: 0,
    created: true,
  });
});

test("two hunks: the excerpt starts in the first and the second counts as more", () => {
  const diff = `${HEAD}@@ -1,2 +1,2 @@\n-a\n+b\n@@ -9,2 +9,2 @@\n x\n-y\n+z\n`;
  const excerpt = excerptOf(diff, 2);
  assert.deepEqual(
    excerpt.lines.map((line) => line.text),
    ["-a", "+b"],
  );
  assert.equal(excerpt.more, 3);
  assert.equal(diffCounts(parseDiff(diff)).created, false);
});

test("an empty diff has no rows", () => {
  assert.deepEqual(excerptOf("", 10), { lines: [], more: 0 });
});
