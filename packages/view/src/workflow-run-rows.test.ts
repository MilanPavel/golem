import assert from "node:assert/strict";
import { test } from "node:test";

import { foldSteps, liveLines, repeatCount, shortTime, stepOutputLine, stepRowState, stepsProgress, stepTook, whatItDid } from "./workflow-run.ts";

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

test("a live run counts against what the daemon expects, and says so when it cannot", () => {
  const rows = foldSteps([step("a"), step("b", { status: "running", title: "Write" })]);
  const known = stepsProgress(rows, { live: true, expected: 7 });
  assert.deepEqual([known.done, known.total, known.known, known.words], [1, 7, true, "1 of 7 steps"]);
  const unknown = stepsProgress(rows, { live: true });
  assert.deepEqual([unknown.done, unknown.known, unknown.words], [1, false, "2 steps so far"]);
  // More rows than the daemon expected: the total was wrong, so there is none.
  assert.equal(stepsProgress(rows, { live: true, expected: 1 }).known, false);
  assert.equal(stepsProgress(foldSteps([step("a")]), { live: true }).words, "1 step so far");
  // A run that is over counts the rows it has, whatever was expected.
  assert.equal(stepsProgress(rows, { expected: 7 }).words, "1 of 2 steps");
});

test("a repeating row counts against the total the workflow said, else the ones finished so far", () => {
  const loop = (said: number | null, statuses: string[]) => foldSteps(statuses.map((status, i) => step(`r${i}`, { title: "Read feed", item: `f${i}`, status, of: said })))[0]!;
  const said = loop(30, ["done", "done", "running"]);
  assert.equal(said.kind === "repeat" && said.total, 30);
  assert.equal(said.kind === "repeat" ? repeatCount(said) : "", "2 of 30");
  const silent = loop(null, ["done", "done", "running"]);
  assert.equal(silent.kind === "repeat" && silent.total, null);
  assert.equal(silent.kind === "repeat" ? repeatCount(silent) : "", "2 so far");
  const over = loop(null, ["done", "done"]);
  assert.equal(over.kind === "repeat" ? repeatCount(over) : "", "2 of 2");
});

test("the live lines name what runs now, with its place in a loop and how long", () => {
  const rows = foldSteps([
    step("a"),
    step("r1", { title: "Reading feed", item: "example.com/rss", status: "running", started_at: T(0), finished_at: null, of: 30 }),
    step("r0", { title: "Reading feed", item: "a.com/rss", status: "done" }),
    step("p1", { title: "Check folder", item: "golem", status: "running", started_at: T(5), finished_at: null }),
    step("p2", { title: "Check folder", item: "docs", status: "running", started_at: T(5), finished_at: null }),
    step("w", { title: "Write", status: "running", started_at: T(8), finished_at: null }),
  ]);
  assert.deepEqual(
    liveLines(rows, Date.parse(T(65))).map((line) => [line.text, line.took]),
    [
      ["Reading feed 1 of 30 \u00b7 example.com/rss", "1m 05s"],
      ["Check folder \u00b7 golem", "1m 00s"],
      ["Check folder \u00b7 docs", "1m 00s"],
      ["Write", "57s"],
    ],
  );
  assert.deepEqual(liveLines(foldSteps([step("a")]), 0), []);
});

test("a step whose result was too large for its event still has its one line", () => {
  assert.equal(stepOutputLine({ kind: "step", result: null, line: "3 rows" }), "3 rows");
  assert.equal(stepOutputLine({ kind: "step", result: "text", line: "other" }), "text");
  assert.equal(stepOutputLine({ kind: "step", result: undefined }), "");
});
