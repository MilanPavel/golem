import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentInfo } from "@golem/client";

import { agentFinished, agentRow, agentRows, agentUsed, agentWish } from "./agents-view.ts";

const bundled = (over: Partial<AgentInfo>): AgentInfo => ({
  name: "explorer",
  description: "Reads and searches.\nSecond line.",
  origin: "bundled",
  wish: "cheapest",
  used: 41,
  finished: 39,
  ...over,
});

const FIXTURES: AgentInfo[] = [
  bundled({}),
  bundled({ name: "worker", wish: "cheapest", asks: true, used: 0, finished: 0 }),
  bundled({ name: "reviewer", wish: "stronger", used: 20, finished: 19 }),
  bundled({ name: "advisor", wish: "stronger", tools: [], used: 4, finished: null }),
  { name: "docs", description: "Writes docs.", origin: "project", wish: "local", used: 3, finished: 3 },
];

test("the four bundled types and a project type make rows", () => {
  const rows = agentRows(FIXTURES);
  assert.deepEqual(
    rows.map((row) => [row.name, row.sourceLabel, row.wish, row.used, row.finished, row.tone]),
    [
      ["explorer", "comes with golem", "Cheapest that fits", "41", "95%", "ok"],
      ["worker", "comes with golem", "Cheapest that fits", "—", "—", "ok"],
      ["reviewer", "comes with golem", "Stronger than the lead", "20", "95%", "ok"],
      ["advisor", "comes with golem", "Stronger than the lead", "4", "—", "ok"],
      ["docs", "this project", "Always local", "3", "100%", "ok"],
    ],
  );
  assert.equal(rows[0]?.description, "Reads and searches.");
});

test("wishes are words, and a model name stays as it is", () => {
  assert.equal(agentWish("same"), "Same as the lead");
  assert.equal(agentWish("budget"), "Always budget");
  assert.equal(agentWish("frontier"), "Always frontier");
  assert.equal(agentWish("claude-sonnet-4-5"), "claude-sonnet-4-5");
  assert.equal(agentWish("toString"), "toString");
});

test("an unused type shows a dash for both counts", () => {
  const unused = bundled({ used: 0, finished: null });
  assert.equal(agentUsed(unused), "—");
  assert.equal(agentFinished(unused), "—");
  assert.equal(agentFinished(bundled({ used: undefined, finished: undefined })), "—");
});

test("errors give a bad row and an untrusted project agent a wait row", () => {
  const broken = agentRow(bundled({ origin: "user", errors: ["line 2: bad"] }));
  assert.equal(broken.tone, "bad");
  assert.deepEqual(broken.warnings, ["line 2: bad"]);
  const blocked = agentRow({ name: "docs", description: "", origin: "project", wish: "same", trusted: false });
  assert.equal(blocked.tone, "wait");
  assert.equal(blocked.warnings.length, 1);
  assert.equal(agentRow(bundled({ trusted: false })).tone, "ok");
});
