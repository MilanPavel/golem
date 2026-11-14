import assert from "node:assert/strict";
import { test } from "node:test";

import { replyWasCut } from "./stop.ts";

test("replyWasCut is true for the length stops", () => {
  assert.equal(replyWasCut("length"), true);
  assert.equal(replyWasCut("max_tokens"), true);
});

test("replyWasCut is false for a normal stop, a load, and nothing", () => {
  for (const reason of ["stop", "end_turn", "load", null, undefined]) {
    assert.equal(replyWasCut(reason), false);
  }
});
