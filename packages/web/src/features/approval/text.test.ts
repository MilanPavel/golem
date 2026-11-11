import { expect, test } from "vitest";
import { APPROVAL_KEYS, approvalKey, approvalTarget, keyDecision, verdictText } from "./text.ts";

test("the target is the file name, the subject, or the arguments", () => {
  expect(approvalTarget({ path: "a/b/c.ts" }, "x")).toEqual({ short: "c.ts", full: "a/b/c.ts" });
  expect(approvalTarget({ command: "ls" }, "ls -la")).toEqual({ short: "ls -la", full: "ls -la" });
  expect(approvalTarget({ command: "ls" }, null)).toEqual({ short: "ls", full: "ls" });
  expect(approvalTarget({}, null)).toBeNull();
});

test("a subject that says nothing is no target", () => {
  for (const empty of ["{}", "[]", "  ", " { } "]) {
    expect(approvalTarget({}, empty)).toBeNull();
  }
  expect(approvalTarget({ q: "x" }, "{}")).toEqual({ short: "x", full: "x" });
});

test("verdicts and keys", () => {
  expect(verdictText({ decision: "allow_always", rule: null, edited: false })).toBe("Always allowed");
  expect(verdictText({ decision: "deny", rule: null, edited: false })).toBe("Denied");
  expect(keyDecision("Enter")).toBe("allow");
  expect(keyDecision("x")).toBeNull();
});

test("the key table is what answers: every row's key does what the list says", () => {
  for (const entry of APPROVAL_KEYS) {
    expect(approvalKey(entry.key)).toBe(entry.does);
    expect(approvalKey(entry.key.toUpperCase())).toBe(entry.does);
  }
  expect(approvalKey("e")).toBe("edit");
  expect(keyDecision("e")).toBeNull();
});
