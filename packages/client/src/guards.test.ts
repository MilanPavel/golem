import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { asChatEvent, isDataQueriesRemoveResult, isDataQueriesSaveResult } from "./guards.ts";

/** Every `type` constant in the generated schema of the `event` notification. */
function eventTypes(): string[] {
  const schema: unknown = JSON.parse(
    readFileSync(new URL("../../protocol/gen/rpc-notification.schema.json", import.meta.url), "utf8"),
  );
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    const type = record["type"];
    if (typeof type === "object" && type !== null && typeof (type as Record<string, unknown>)["const"] === "string") {
      found.add((type as Record<string, unknown>)["const"] as string);
    }
    Object.values(record).forEach(walk);
  };
  walk(schema);
  return [...found].sort();
}

test("every event type of the protocol passes the client's filter", () => {
  const types = eventTypes();
  assert.ok(types.includes("file.changed"));
  assert.ok(types.length > 30);
  const dropped = types.filter(
    (type) => asChatEvent({ type, seq: 1, session_id: "s_test", run_id: null, ts: "t", data: {} }) === undefined,
  );
  assert.deepEqual(dropped, []);
});

test("an unknown type and a malformed event are dropped", () => {
  assert.equal(asChatEvent({ type: "no.such", seq: 1, session_id: "s_test", data: {} }), undefined);
  assert.equal(asChatEvent({ type: "file.changed", session_id: "s_test", data: {} }), undefined);
  assert.equal(asChatEvent(null), undefined);
});

test("a helper event type this build does not list is dropped, and the six it lists pass", () => {
  const base = { seq: 1, session_id: "s_test", run_id: null, ts: "t", data: {} };
  assert.equal(asChatEvent({ ...base, type: "helper.future" }), undefined);
  for (const type of ["helper.started", "helper.model", "helper.step", "helper.state", "helper.wait", "helper.ended"]) {
    assert.notEqual(asChatEvent({ ...base, type }), undefined);
  }
});

test("a memory.changed payload is not a chat event", () => {
  assert.equal(asChatEvent({ id: "mem_1", change: "created", scope: "you", folder: null }), undefined);
  assert.equal(asChatEvent({ type: "memory.changed", seq: 1, session_id: "s_test", run_id: null, ts: "t", data: {} }), undefined);
});

test("a run.list answer with a workflow run is accepted", async () => {
  const { isRunListResult } = await import("./guards.ts");
  const row = { session_id: "s_1", kind: "workflow", origin: "workflow:morning_briefing", status: "succeeded", approvals: 0, steps: 7, workflow_run_id: "wr_1" };
  assert.equal(isRunListResult({ runs: [row] }), true);
  assert.equal(isRunListResult({ runs: [{ ...row, kind: "chat" }] }), false);
});

test("a saved query's answer has a name and its SQL", () => {
  assert.equal(isDataQueriesSaveResult({ query: { name: "Totals", sql: "select 1" } }), true);
  assert.equal(isDataQueriesSaveResult({ query: { name: "Totals" } }), false);
  assert.equal(isDataQueriesSaveResult({}), false);
  assert.equal(isDataQueriesRemoveResult({}), true);
  assert.equal(isDataQueriesRemoveResult(null), false);
});
