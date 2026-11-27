import assert from "node:assert/strict";
import { test } from "node:test";

import { isWorkflowReadOutputResult } from "./guards.ts";

test("workflow.read_output result needs a path, the text and the size", () => {
  assert.equal(isWorkflowReadOutputResult({ path: "/a.md", text: "x", truncated: false, size: 1 }), true);
  assert.equal(isWorkflowReadOutputResult({ path: "/a.md", text: "x", size: 1 }), true);
  assert.equal(isWorkflowReadOutputResult({ path: "/a.md", size: 1 }), false);
  assert.equal(isWorkflowReadOutputResult(null), false);
});
