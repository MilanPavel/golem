import assert from "node:assert/strict";
import { test } from "node:test";

import { allRunsWords, checksWords, lastRunWords, routinePillWords } from "./workflow-header.ts";

const NOW = Date.parse("2026-11-27T12:00:00");
const routine = (name: string) => ({ config: { name, workflow: "w", schedule: "0 8 * * *" }, next_at: null });

test("the Routine pill says none, the one, or a count", () => {
  assert.equal(routinePillWords([], NOW), "Not scheduled · it runs only when you press Run");
  assert.match(routinePillWords([routine("a")], NOW), /08:00/);
  assert.equal(routinePillWords([routine("a"), routine("b")], NOW), "2 routines");
});

test("the Last run pill gives the state, when and how long", () => {
  const run = { status: "succeeded" as const, started_at: "2026-11-27T11:22:00", ended_at: "2026-11-27T11:22:47" };
  assert.equal(lastRunWords(run, NOW), "finished today 11:22 · 0m 47s");
  assert.equal(lastRunWords({ status: "failed" }, NOW), "failed");
});

test("the run and check counts", () => {
  assert.equal(allRunsWords(4), "All 4 runs");
  assert.equal(allRunsWords(1), "1 run");
  assert.equal(checksWords(0), "checks pass");
  assert.equal(checksWords(1), "1 problem");
  assert.equal(checksWords(3), "3 problems");
});
