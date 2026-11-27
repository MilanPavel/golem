import assert from "node:assert/strict";
import { test } from "node:test";

import { foldSteps, shortTime, stepRowState, stepsProgress, stepTook, whatItDid } from "./workflow-run.ts";

const T = (s: number) => new Date(Date.UTC(2026, 10, 26, 8, 0, s)).toISOString();
const step = (key: string, extra: Record<string, unknown> = {}) => ({ key, kind: "step", title: key, status: "done", started_at: T(0), finished_at: T(10), ...extra });

test("a time reads <1s, 47s and 2m 05s", () => {
  assert.equal(shortTime(400), "<1s");
  assert.equal(shortTime(47_000), "47s");
  assert.equal(shortTime(125_000), "2m 05s");
  assert.equal(shortTime(-1), "");
});

test("a step took its time, a running one runs to now, one not started has none", () => {
  assert.equal(stepTook(step("a"), 0), "10s");
  assert.equal(stepTook(step("b", { status: "running", finished_at: null }), Date.parse(T(65))), "1m 05s");
  assert.equal(stepTook({ status: "pending" }, 0), "");
});

test("steps with the same title and an item fold into one row, wherever they are", () => {
  const rows = foldSteps([step("a"), ...Array.from({ length: 30 }, (_, i) => step(`r${i}`, { title: "Read", item: `f${i}`, status: i === 3 ? "failed" : "done" })), step("z")]);
  assert.equal(rows.length, 3);
  const fold = rows[1]!;
  assert.equal(fold.kind, "repeat");
  if (fold.kind === "repeat") {
    assert.equal(fold.items.length, 30);
    assert.equal(fold.done, 29);
    assert.equal(fold.state, "failed");
  }
  assert.equal(foldSteps(Array.from({ length: 9 }, (_, i) => step(`s${i}`))).length, 9);
});

test("a folded row is working while any item works, and done when all are", () => {
  const items = (statuses: string[]) => foldSteps(statuses.map((status, i) => step(`r${i}`, { title: "Read", item: `f${i}`, status })))[0]!;
  assert.equal(stepRowState(items(["done", "running", "pending"])), "running");
  assert.equal(stepRowState(items(["pending", "pending"])), "pending");
  assert.equal(stepRowState(items(["done", "skipped"])), "done");
});

test("progress counts finished rows of the rows known and names the one working", () => {
  const rows = foldSteps([step("a"), step("b", { status: "running", title: "Write" }), step("c", { status: "pending" })]);
  const progress = stepsProgress(rows);
  assert.deepEqual([progress.done, progress.total, progress.current, progress.words], [1, 3, "Write", "1 of 3 steps"]);
});

test("what it did reads the steps that notify, review or call a tool", () => {
  const did = whatItDid([step("a", { kind: "llm", result: "x" }), step("b", { kind: "notify", result: "sent" }), step("c", { kind: "tool", result: null }), step("d", { kind: "review", result: { verdict: "approve" } })]);
  assert.deepEqual(
    did.map((one) => one.key),
    ["b", "d"],
  );
});
