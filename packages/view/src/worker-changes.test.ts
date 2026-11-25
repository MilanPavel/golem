import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent } from "@golem/client";

import { applyGreenLabel, copiesFooter, greenCount, workerBlocks, workerDiffStat } from "./worker-changes.ts";
import { workerFixture } from "./worker-changes.fixture.ts";

const writes = (agent: string): boolean => agent === "coder";
const ev = (type: string, data: Record<string, unknown>): ChatEvent => ({ seq: 1, session_id: "lead", run_id: "r1", ts: "t", type, data }) as unknown as ChatEvent;
const END = { stopped: "done", model_calls: 1, tokens: 1, answer_tokens: 1, cost_usd: 0, duration_ms: 1, working_ms: 1 };

test("five workers: two green, one failed, one stopped, one running", () => {
  const blocks = workerBlocks(workerFixture(), { writes });
  assert.deepEqual(
    blocks.map((block) => [block.label, block.status]),
    [["httpx", "green"], ["aiohttp", "green"], ["sqlmodel", "stopped"], ["pydantic", "failed"], ["trio", "running"]],
  );
  const [httpx, , sqlmodel, pydantic, trio] = blocks;
  assert.equal(httpx?.checksLine, "tests pass");
  assert.equal(workerDiffStat(httpx ?? { added: 0, removed: 0 }), "+38 −12");
  assert.deepEqual(httpx?.actions, ["view", "apply"]);
  assert.equal(sqlmodel?.checksLine, "stopped: 25 calls · tests fail");
  assert.deepEqual(sqlmodel?.actions, ["view", "retry", "discard"]);
  assert.equal(pydantic?.checksLine, "tests and lint fail");
  assert.deepEqual(trio?.actions, []);
  assert.equal(trio?.checksLine, "");
});

test("without a writes check, a running helper is not shown", () => {
  assert.deepEqual(workerBlocks(workerFixture()).map((block) => block.label), ["httpx", "aiohttp", "sqlmodel", "pydantic"]);
});

test("a helper without a copy is no block", () => {
  const events = [ev("helper.started", { call_id: "d2", index: 0, helper_id: "x", agent: "explorer", label: "x", model: "m", wish: "", pick_reason: "" }), ev("helper.ended", { call_id: "d2", index: 0, ...END })];
  assert.deepEqual(workerBlocks(events, { writes }), []);
});

test("applied and discarded come from the lead's events and have no actions", () => {
  const events = [...workerFixture(), ev("helper.applied", { helper_id: "h0", change_ids: ["c1"] }), ev("helper.discarded", { helper_id: "h3" })];
  const blocks = workerBlocks(events, { writes });
  assert.deepEqual(blocks.map((block) => block.status), ["applied", "green", "stopped", "discarded", "running"]);
  assert.deepEqual(blocks[0]?.actions, []);
  assert.equal(greenCount(blocks), 1);
});

test("a clean end with no checks is green and says why", () => {
  const events = [
    ev("helper.started", { call_id: "d3", index: 0, helper_id: "n", agent: "coder", label: "n", model: "m", wish: "", pick_reason: "" }),
    ev("helper.ended", { call_id: "d3", index: 0, ...END, diff_artifact_id: "a", files: [], checks: "none", checks_note: "no checks found" }),
  ];
  const [block] = workerBlocks(events);
  assert.equal(block?.status, "green");
  assert.equal(block?.checksLine, "no checks found");
});

test("lint alone fails in the singular", () => {
  const events = workerFixture().map((event) => (event.type === "helper.ended" && event.data.index === 3 ? ev("helper.ended", { ...event.data, checks_failed: ["lint"] }) : event));
  assert.equal(workerBlocks(events)[3]?.checksLine, "lint fails");
});

test("apply label and footer", () => {
  assert.equal(applyGreenLabel(0), null);
  assert.equal(applyGreenLabel(1), "Apply the green one");
  assert.equal(applyGreenLabel(2), "Apply the 2 green");
  const blocks = workerBlocks(workerFixture(), { writes });
  assert.equal(greenCount(blocks), 2);
  assert.equal(copiesFooter(blocks, "~/repos/app"), "in copies · nothing in ~/repos/app has changed");
  const after = workerBlocks([...workerFixture(), ev("helper.applied", { helper_id: "h0", change_ids: [] })], { writes });
  assert.equal(copiesFooter(after, "~/repos/app"), "1 applied · 4 in copies");
  assert.equal(copiesFooter([], "~/repos/app"), null);
});
