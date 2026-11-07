import assert from "node:assert/strict";
import { test } from "node:test";

import { parseJsonArguments, tryArguments, tryFields, tryInitial } from "./mcp-try.ts";

const schema = {
  type: "object",
  required: ["path"],
  properties: {
    path: { type: "string", description: "Where." },
    depth: { type: "integer", default: 2 },
    ratio: { type: "number" },
    hidden: { type: "boolean" },
    mode: { enum: ["fast", "slow"] },
  },
};

test("a schema of plain arguments becomes fields, with what is required and the defaults", () => {
  const fields = tryFields(schema);
  assert.deepEqual(fields?.map((field) => [field.id, field.kind, field.required]), [
    ["path", "text", true],
    ["depth", "integer", false],
    ["ratio", "number", false],
    ["hidden", "boolean", false],
    ["mode", "choice", false],
  ]);
  assert.equal(fields?.[0]?.hint, "Where.");
  assert.deepEqual(fields?.[4]?.choices, ["fast", "slow"]);
  assert.deepEqual(tryInitial(fields ?? []), { path: "", depth: "2", ratio: "", hidden: "", mode: "" });
});

test("a schema the form cannot draw falls back to JSON", () => {
  assert.equal(tryFields(undefined), null);
  assert.equal(tryFields({ type: "array" }), null);
  assert.equal(tryFields({ type: "object", properties: { a: { type: "object" } } }), null);
  assert.equal(tryFields({ type: "object", properties: { a: { oneOf: [{ type: "string" }] } } }), null);
  assert.equal(tryFields({ type: "object", properties: { a: { enum: [1, 2] } } }), null);
  assert.deepEqual(tryFields({ type: "object" }), []);
});

test("the form makes typed arguments, leaves empty optional fields out, and says what is wrong", () => {
  const fields = tryFields(schema) ?? [];
  assert.deepEqual(tryArguments(fields, { path: "/tmp", depth: "3", ratio: "0.5", hidden: "true", mode: "fast" }), {
    arguments: { path: "/tmp", depth: 3, ratio: 0.5, hidden: true, mode: "fast" },
  });
  assert.deepEqual(tryArguments(fields, { path: "/tmp" }), { arguments: { path: "/tmp" } });
  assert.deepEqual(tryArguments(fields, { path: "", depth: "1.5", ratio: "x" }), {
    errors: { path: "Required.", depth: "A whole number.", ratio: "A number." },
  });
  assert.deepEqual(tryArguments([{ id: "on", kind: "boolean", required: true, hint: null, choices: [], initial: "" }], {}), {
    arguments: { on: false },
  });
});

test("JSON arguments: nothing is an empty object, and anything else must be an object", () => {
  assert.deepEqual(parseJsonArguments("  "), { arguments: {} });
  assert.deepEqual(parseJsonArguments('{"n": 3}'), { arguments: { n: 3 } });
  assert.ok("error" in parseJsonArguments("[1]"));
  assert.ok("error" in parseJsonArguments("{"));
});
