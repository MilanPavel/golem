import assert from "node:assert/strict";
import { test } from "node:test";

import { groupWords, lastRunLine, outlineLine, outlineNotes, outlineRows, repeatWords, stepKindWords, stepRanTimes } from "./outline-rows.ts";

test("a kind reads in words, and an unknown kind reads as it is", () => {
  assert.deepEqual(["step", "llm", "agent", "review", "notify", "tool", "skill", "code"].map(stepKindWords), ["Python", "Model", "Agent", "Review", "Inbox", "Tool", "Skill", "Code"]);
  assert.equal(stepKindWords("other"), "other");
});

const NOW = new Date("2026-11-26T12:00:00").getTime();

test("a step reads as its kind, then agent, for each, if, gets and budget", () => {
  assert.deepEqual(outlineNotes({ id: "a", kind: "tool", title: "List" }), ["tool"]);
  assert.deepEqual(
    outlineNotes({ id: "b", kind: "agent", title: "Note", agent: "writer", for_each: "prs", condition: "prs", gets: "prs", budget: "$0.50" }),
    ["agent", "agent writer", "Once for each prs", "if prs", "gets prs", "budget $0.50"],
  );
});

test("a repeating step reads once, whether the code names the loop or only what it loops over", () => {
  assert.equal(repeatWords("for each f in folders"), "Once for each f in folders");
  assert.equal(repeatWords("f in folders"), "Once for each f in folders");
  assert.equal(repeatWords("for each a in got; for each b in a.children"), "Once for each a in got; Once for each b in a.children");
  assert.equal(repeatWords("while busy"), "while busy");
  assert.deepEqual(outlineNotes({ id: "a", kind: "step", title: "Check", for_each: "for each f in folders" }), ["step", "Once for each f in folders"]);
});

test("a group reads its title, else At the same time, and a step in none has no group", () => {
  assert.equal(groupWords({ group: "parallel-1", group_title: "Both folders" }), "Both folders");
  assert.equal(groupWords({ group: "parallel-1", group_title: null }), "At the same time");
  assert.equal(groupWords({ group: "parallel-1" }), "At the same time");
  assert.equal(groupWords({ group: null, group_title: "x" }), null);
  const rows = outlineRows([{ id: "a", kind: "step", title: "Check", item: "golem", group: "parallel-1" }, { id: "b", kind: "step", title: "Other" }]);
  assert.deepEqual(rows.map((row) => [row.item, row.group]), [["golem", "At the same time"], [null, null]]);
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
