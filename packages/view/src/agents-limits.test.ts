import assert from "node:assert/strict";
import { test } from "node:test";

import { configLimitLabels, limitFields, limitsChange, limitsSavedNote, limitTexts, parseLimit } from "./agents-edit.ts";

test("a typed limit is a whole number, or dollars for cost, or empty for none", () => {
  assert.deepEqual(parseLimit("max_calls", " 20 "), { ok: true, value: 20 });
  assert.deepEqual(parseLimit("max_calls", ""), { ok: true, value: null });
  assert.deepEqual(parseLimit("max_cost", "0.5"), { ok: true, value: 0.5 });
  assert.deepEqual(parseLimit("max_cost", "0"), { ok: true, value: 0 });
  for (const text of ["0", "1.5", "-2", "ten"]) assert.equal(parseLimit("working_seconds", text).ok, false);
  for (const text of ["$1", "1,5", "-1"]) assert.equal(parseLimit("max_cost", text).ok, false);
});

test("only a changed box is sent, an emptied one goes in clear, a bad one is an error", () => {
  const before = limitTexts({ max_calls: 15, max_seconds: 300, max_cost_usd: 0.5 });
  assert.deepEqual(before, { max_calls: "15", working_seconds: "300", max_cost: "0.5", max_tokens: "" });
  assert.deepEqual(limitsChange(before, { ...before, max_calls: "20" }).change, { max_calls: 20 });
  assert.deepEqual(limitsChange(before, { ...before, max_cost: "", max_tokens: "9000" }).change, { max_tokens: 9000, clear: ["max_cost"] });
  assert.equal(limitsChange(before, { ...before, max_cost: "0.50" }).empty, true);
  const bad = limitsChange(before, { ...before, max_calls: "0" });
  assert.deepEqual(bad.errors, { max_calls: "Enter a whole number, 1 or more." });
  assert.equal(bad.empty, false);
  assert.deepEqual(limitsChange(before, { ...before, max_calls: "", max_tokens: "5" }, ["max_tokens"]).change, { max_tokens: 5 });
});

test("the fields start with cost for a cloud-only setup", () => {
  assert.deepEqual(limitFields("cloud").map((field) => field.key), ["max_cost", "max_calls", "working_seconds", "max_tokens"]);
  assert.deepEqual(limitFields("mixed").map((field) => field.key), ["max_calls", "working_seconds", "max_cost", "max_tokens"]);
  assert.deepEqual(limitFields("local").map((field) => field.label), ["Tool calls", "Working time", "Cost", "Tokens"]);
});

test("a value that config.toml sets is named by its fact label", () => {
  assert.deepEqual(configLimitLabels(["max_seconds", "max_cost_usd", "answer_chars"]), ["time", "cost", "answer chars"]);
  assert.deepEqual(configLimitLabels(undefined), []);
  assert.match(limitsSavedNote("project"), /read-only/);
  assert.equal(limitsSavedNote("user"), "Saved in the agent's file.");
});
