import assert from "node:assert/strict";
import { test } from "node:test";

import { lastRunLine, outlineLine, outlineNotes, outlineRows, stepRanTimes } from "./outline-rows.ts";

const NOW = new Date("2026-11-26T12:00:00").getTime();

test("a step reads as its kind, then agent, for each, if, gets and budget", () => {
  assert.deepEqual(outlineNotes({ id: "a", kind: "tool", title: "List" }), ["tool"]);
  assert.deepEqual(
    outlineNotes({ id: "b", kind: "agent", title: "Note", agent: "writer", for_each: "prs", condition: "prs", gets: "prs", budget: "$0.50" }),
    ["agent", "agent writer", "for each prs", "if prs", "gets prs", "budget $0.50"],
  );
});

test("the rows are numbered from 1 in file order, with the first line", () => {
  const rows = outlineRows([
    { id: "a", kind: "tool", title: "List", lines: [12, 14], key: "list" },
    { id: "b", kind: "review", title: "Look", lines: [null, null] },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.number, row.title, row.line, row.key]),
    [
      [1, "List", 12, "list"],
      [2, "Look", null, null],
    ],
  );
  assert.equal(outlineLine({ lines: [0, 3] }), null);
  assert.equal(outlineLine({}), null);
});

test("the last run says when, how it ended and what it cost", () => {
  const steps = [
    { key: "list", started_at: "2026-11-26T08:30:00", cost_usd: 0.01 },
    { key: "note", started_at: null, cost_usd: 0.03 },
  ];
  assert.equal(lastRunLine({ started_at: "2026-11-26T08:30:00", status: "succeeded" }, steps, NOW), "last run 08:30 · succeeded · $0.04");
  assert.equal(lastRunLine({ started_at: null, status: "failed" }, [], NOW), "last run · failed");
  assert.equal(lastRunLine(null, steps, NOW), "");
  assert.deepEqual([...stepRanTimes(steps, NOW)], [["list", "08:30"]]);
});
