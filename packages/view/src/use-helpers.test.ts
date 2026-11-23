import assert from "node:assert/strict";
import { test } from "node:test";

import { helperCardOf, helperBatchHead, helperJobsOf, isUseHelpersQuestion, USE_HELPERS_POSITIONS, useHelpersExplain, useHelpersPosition } from "./use-helpers.ts";

test("three positions with their labels and one line each", () => {
  assert.deepEqual(
    USE_HELPERS_POSITIONS.map((p) => [p.value, p.label]),
    [
      ["when_needed", "When needed"],
      ["ask", "Ask me first"],
      ["never", "Never"],
    ],
  );
  for (const p of USE_HELPERS_POSITIONS) assert.ok(p.explain.length > 0 && !p.explain.includes("\n"));
  assert.ok(useHelpersExplain("when_needed").startsWith("When needed: the reading would not fit the window"));
  assert.ok(useHelpersExplain("ask").startsWith("Ask me first: "));
  assert.ok(useHelpersExplain("never").startsWith("Never: "));
  assert.equal(useHelpersPosition("weird").value, "when_needed");
  assert.equal(useHelpersPosition(undefined).value, "when_needed");
});

test("the head counts helpers and groups agent types", () => {
  assert.equal(helperBatchHead(["explorer"]), "1 helper · explorer");
  assert.equal(helperBatchHead(["explorer", "worker", "explorer"]), "3 helpers · explorer ×2, worker");
  assert.equal(helperBatchHead([], 4), "4 helpers");
  assert.equal(helperBatchHead([]), "1 helper");
});

test("a single delegate call gives one job", () => {
  const card = helperCardOf({ args: { agent: "worker", brief: "Upgrade httpx" } });
  assert.equal(card.head, "1 helper · worker");
  assert.deepEqual(card.jobs, [{ agent: "worker", brief: "Upgrade httpx", label: null }]);
  assert.deepEqual(
    card.actions.map((a) => [a.id, a.label, a.run, a.primary]),
    [
      ["run", "Run", true, true],
      ["chat", "Do it in the chat", false, false],
    ],
  );
});

test("a batch gives its jobs, with labels", () => {
  const card = helperCardOf({
    args: { batch: [{ agent: "explorer", brief: "a", label: "A" }, { agent: "explorer", brief: "b" }, { agent: "worker", brief: "c", label: " " }] },
  });
  assert.equal(card.head, "3 helpers · explorer ×2, worker");
  assert.deepEqual(
    card.jobs.map((j) => j.label),
    ["A", null, null],
  );
});

test("the pending item stands in when there are no arguments", () => {
  assert.equal(helperCardOf({ helperCount: 3, agents: ["explorer", "explorer", "worker"] }).head, "3 helpers · explorer ×2, worker");
  assert.equal(helperCardOf({ helperCount: 2 }).head, "2 helpers");
  assert.equal(helperCardOf({}).head, "1 helper");
  assert.deepEqual(helperJobsOf({}), []);
  assert.equal(helperJobsOf({ brief: "x" })[0]?.agent, "explorer");
});

test("only delegate asked by use_helpers is this question", () => {
  assert.equal(isUseHelpersQuestion({ name: "delegate", source: "use_helpers" }), true);
  assert.equal(isUseHelpersQuestion({ source: "use_helpers" }), true);
  assert.equal(isUseHelpersQuestion({ name: "delegate", source: "rule" }), false);
  assert.equal(isUseHelpersQuestion({ name: "shell", source: "use_helpers" }), false);
  assert.equal(isUseHelpersQuestion(null), false);
});
