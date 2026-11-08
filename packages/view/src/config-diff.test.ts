import assert from "node:assert/strict";
import { test } from "node:test";

import { changedOnDisk, problemLine, problemLines, unifiedDiff } from "./config-diff.ts";

test("the same text has no diff", () => {
  assert.equal(unifiedDiff("a = 1\n", "a = 1\n", "config.toml"), "");
});

test("a changed line is a delete and an add with its neighbours around it", () => {
  const before = "[a]\nx = 1\ny = 2\n[b]\nz = 3\n";
  const after = "[a]\nx = 1\ny = 5\n[b]\nz = 3\n";
  assert.equal(unifiedDiff(before, after, "config.toml"), "--- a/config.toml\n+++ b/config.toml\n@@ -1,5 +1,5 @@\n [a]\n x = 1\n-y = 2\n+y = 5\n [b]\n z = 3\n");
});

test("far apart changes are two hunks, with line numbers that follow the new text", () => {
  const before = Array.from({ length: 20 }, (_, n) => `l${n}`).join("\n") + "\n";
  const after = ["top", ...Array.from({ length: 19 }, (_, n) => `l${n + 1}`), "end"].join("\n") + "\n";
  const diff = unifiedDiff(before, after, "f");
  const heads = diff.split("\n").filter((line) => line.startsWith("@@"));
  assert.equal(heads.length, 2);
  assert.match(heads[0] ?? "", /^@@ -1,4 \+1,4 @@/);
});

test("a new file is all adds, and an emptied one all deletes", () => {
  assert.equal(unifiedDiff("", "a\nb\n", "f"), "--- a/f\n+++ b/f\n@@ -0,0 +1,2 @@\n+a\n+b\n");
  assert.equal(unifiedDiff("a\n", "", "f"), "--- a/f\n+++ b/f\n@@ -1,1 +0,0 @@\n-a\n");
});

test("problems read as lines, and a conflict is told apart", () => {
  assert.equal(problemLine({ line: 3, column: 5, path: "mcp.x.url", message: "not a URL" }), "line 3:5: not a URL (mcp.x.url)");
  assert.equal(problemLine({ message: "bad" }), "bad");
  assert.equal(changedOnDisk([{ message: "config.toml changed on disk since it was read" }]), true);
  assert.equal(changedOnDisk([{ message: "bad" }]), false);
  assert.deepEqual([...problemLines([{ line: 2, message: "a" }, { message: "b" }, { line: 2, message: "c" }, { line: 9, message: "d" }])], [2, 9]);
});
