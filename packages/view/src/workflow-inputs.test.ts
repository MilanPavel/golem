import assert from "node:assert/strict";
import { test } from "node:test";
import { inputFields, startInputs } from "./workflow-inputs.ts";

test("an empty field with a default is left out, so the workflow's default applies", () => {
  const fields = inputFields([{ name: "since", type: "str", default: '"1d"' }, { name: "repo" }]);
  assert.deepEqual(fields.map((field) => field.required), [false, true]);
  assert.deepEqual(startInputs(fields, { since: "", repo: "golem" }), { repo: "golem" });
});
