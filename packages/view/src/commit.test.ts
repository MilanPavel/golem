import assert from "node:assert/strict";
import { test } from "node:test";

import { branchLine, commitTitle, committedLine, failureTail, withSuggestion } from "./commit.ts";

test("the title counts the files and names the branch", () => {
  assert.equal(commitTitle(3, "main"), "commit 3 files on main");
  assert.equal(commitTitle(1, "main"), "commit 1 file on main");
  assert.equal(commitTitle(2, null), "commit 2 files");
  assert.equal(branchLine("main"), "on main");
  assert.equal(branchLine(null), "Not on a branch");
});

test("the notice names the short hash", () => {
  assert.equal(committedLine("a1b2c3d"), "Committed a1b2c3d");
  assert.equal(committedLine(null), "Committed");
});

test("the failure tail keeps the last six non-empty lines", () => {
  const output = ["one", "", "two", "three", "four", "five", "six", "seven", ""].join("\n");
  assert.deepEqual(failureTail(output), ["two", "three", "four", "five", "six", "seven"]);
  assert.deepEqual(failureTail(""), []);
});

test("a suggestion fills an empty box and never replaces text", () => {
  assert.equal(withSuggestion("", "fix: a"), "fix: a");
  assert.equal(withSuggestion("  ", "fix: a"), "fix: a");
  assert.equal(withSuggestion("mine", "fix: a"), "mine");
});
