import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCAL_ONLY_LABEL, localOnlyLabel } from "./local-only.ts";

test("a session whose folder stays on this Mac is named", () => {
  assert.equal(localOnlyLabel({ local_only: true }), LOCAL_ONLY_LABEL);
});

test("any other session, an older daemon's included, has no label", () => {
  assert.equal(localOnlyLabel({ local_only: false }), "");
  assert.equal(localOnlyLabel({}), "");
  assert.equal(localOnlyLabel(null), "");
  assert.equal(localOnlyLabel(undefined), "");
});
