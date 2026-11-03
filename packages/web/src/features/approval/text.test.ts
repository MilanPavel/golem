import { expect, test } from "vitest";
import { approvalTarget, keyDecision, verdictText } from "./text.ts";

test("the target is the file name, the subject, or the arguments", () => {
  expect(approvalTarget({ path: "a/b/c.ts" }, "x")).toEqual({ short: "c.ts", full: "a/b/c.ts" });
  expect(approvalTarget({ command: "ls" }, "ls -la")).toEqual({ short: "ls -la", full: "ls -la" });
  expect(approvalTarget({ command: "ls" }, null)).toEqual({ short: "ls", full: "ls" });
  expect(approvalTarget({}, null)).toBeNull();
});

test("verdicts and keys", () => {
  expect(verdictText({ decision: "allow_always", rule: null, edited: false })).toBe("Always allowed");
  expect(verdictText({ decision: "deny", rule: null, edited: false })).toBe("Denied");
  expect(keyDecision("Enter")).toBe("allow");
  expect(keyDecision("x")).toBeNull();
});
