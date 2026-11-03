import assert from "node:assert/strict";
import { test } from "node:test";

import { editedArgs, parseArgs } from "./approval-args.ts";

test("only one JSON object is accepted", () => {
  assert.deepEqual(parseArgs('{"path": "b.py"}'), { ok: true, args: { path: "b.py" } });
  for (const text of ["[1]", "[]", "null", '"x"', "1", "{"]) {
    assert.equal(parseArgs(text).ok, false, text);
  }
});

test("the reasons name the problem", () => {
  const bad = parseArgs("{");
  assert.ok(!bad.ok && bad.error.startsWith("not JSON: "));
  assert.deepEqual(parseArgs("[]"), { ok: false, error: "the arguments must be one JSON object" });
});

test("arguments that were not changed are not edited", () => {
  const original = { path: "a.py", n: 1 };
  assert.equal(editedArgs(original, { ...original }), null);
  assert.deepEqual(editedArgs(original, { path: "b.py" }), { path: "b.py" });
});
