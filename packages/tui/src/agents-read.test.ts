import assert from "node:assert/strict";
import { test } from "node:test";

import { limitsText, rule, wrapPrompt, wrapText } from "./agents-read.ts";

test("wrapText breaks at words and cuts a word longer than the line", () => {
  assert.deepEqual(wrapText("one two three four", 9), ["one two", "three", "four"]);
  assert.deepEqual(wrapText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrapText("   ", 9), []);
});

test("wrapPrompt keeps blank lines and indents, and wraps long lines", () => {
  assert.deepEqual(wrapPrompt("a b c\n\n  - one two three\n", 8), ["a b c", "", "  - one two", "  three"]);
});

test("limitsText says calls, time and answer, and no limit when the file sets none", () => {
  assert.equal(
    limitsText([
      { value: "15", label: "tool calls" },
      { value: "5 min", label: "time" },
      { value: "6000", label: "answer chars" },
      { value: "$0.50", label: "cost" },
    ]),
    "15 tool calls · 5 min · answer 6000 chars · $0.50 cost",
  );
  assert.equal(limitsText([{ value: "no limit", label: "time" }]), "no time limit");
});

test("rule fills the width", () => {
  assert.equal(rule("prompt", 20), "── prompt ──────────");
  assert.equal(rule("prompt", 3), "── prompt ");
});
