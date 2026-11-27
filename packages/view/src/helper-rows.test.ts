import assert from "node:assert/strict";
import { test } from "node:test";

import { groupHelpers, helperCountWords, helperLabel, helperRowState, helperSquare, helperWords, isHelperSession, isTrimmedHelper, isWorkflowSession, type HelperSession } from "./helper-rows.ts";

function s(id: string, status: string, extra: Partial<HelperSession> = {}): HelperSession {
  return { session_id: id, status, ...extra };
}

const LEAD = s("lead", "running");

test("the session of a workflow run is not a row, but its helpers still group under it", () => {
  const list = [s("wf", "idle", { origin: "workflow:daily" }), s("h1", "running", { parent_session_id: "wf" }), LEAD];
  const { rows, squares } = groupHelpers(list);
  assert.deepEqual(rows.map((r) => r.session_id), ["lead"]);
  assert.deepEqual(squares.get("wf"), ["working"]);
  assert.equal(isWorkflowSession({ origin: "workflow:daily" }), true);
  assert.equal(isWorkflowSession({ origin: "routine:daily" }), false);
  assert.equal(isWorkflowSession({}), false);
});

test("a lead with two helpers is one row with two squares", () => {
  const list = [LEAD, s("h1", "running", { parent_session_id: "lead" }), s("h2", "running", { parent_session_id: "lead" })];
  const { rows, squares } = groupHelpers(list);
  assert.deepEqual(rows.map((r) => r.session_id), ["lead"]);
  assert.deepEqual(squares.get("lead"), ["working", "working"]);
});

test("a helper that asks has the asking square, a queued one the queued square", () => {
  const list = [
    LEAD,
    s("h1", "waiting", { parent_session_id: "lead" }),
    s("h2", "running", { parent_session_id: "lead", wait_reason: "slot" }),
    s("h3", "running", { parent_session_id: "lead", wait_reason: "you" }),
  ];
  assert.deepEqual(groupHelpers(list).squares.get("lead"), ["asking", "queued", "asking"]);
});

test("helpers that are done leave no squares", () => {
  const list = [LEAD, s("h1", "idle", { parent_session_id: "lead" }), s("h2", "closed", { parent_session_id: "lead" })];
  const { rows, squares } = groupHelpers(list);
  assert.deepEqual(rows.map((r) => r.session_id), ["lead"]);
  assert.equal(squares.size, 0);
});

test("a helper whose lead is not in the list is not a row and shows nowhere", () => {
  const list = [s("a", "idle"), s("h1", "running", { parent_session_id: "gone" })];
  const { rows, squares } = groupHelpers(list);
  assert.deepEqual(rows.map((r) => r.session_id), ["a"]);
  assert.equal(squares.size, 0);
});

test("an older daemon, with no parent_session_id, keeps every row", () => {
  const list = [s("a", "running"), s("b", "idle", { parent_session_id: null }), s("c", "waiting")];
  const { rows, squares } = groupHelpers(list);
  assert.equal(rows.length, 3);
  assert.equal(squares.size, 0);
});

const TWO = [
  LEAD,
  s("h2", "idle", { parent_session_id: "lead", created_at: "2026-11-21T10:05:00Z" }),
  s("h1", "running", { parent_session_id: "lead", created_at: "2026-11-21T10:00:00Z" }),
  s("other", "idle"),
  s("o1", "running", { parent_session_id: "other" }),
];

test("the open lead has its helpers as rows, in the order of the call", () => {
  const { rows, nested } = groupHelpers(TWO, { openId: "lead" });
  assert.deepEqual(rows.map((r) => r.session_id), ["lead", "other"]);
  assert.deepEqual(nested.get("lead")?.map((r) => r.session_id), ["h1", "h2"]);
  assert.equal(nested.has("other"), false);
});

test("a lead stays open while one of its helpers is the open chat", () => {
  assert.deepEqual(groupHelpers(TWO, { openId: "h2" }).nested.get("lead")?.map((r) => r.session_id), ["h1", "h2"]);
});

test("another chat open, and no show helpers, leaves no helper rows", () => {
  assert.equal(groupHelpers(TWO, { openId: "other" }).nested.has("lead"), false);
  assert.equal(groupHelpers(TWO).nested.size, 0);
});

test("a trimmed helper is not a row, and one with the field empty is", () => {
  const list = [
    LEAD,
    s("h1", "idle", { parent_session_id: "lead", trimmed_at: "2026-11-21T10:00:00Z" }),
    s("h2", "idle", { parent_session_id: "lead", trimmed_at: null }),
    s("h3", "idle", { parent_session_id: "lead" }),
  ];
  assert.deepEqual(groupHelpers(list, { openId: "lead" }).nested.get("lead")?.map((r) => r.session_id), ["h2", "h3"]);
  assert.equal(isTrimmedHelper(list[1]!), true);
  assert.equal(isTrimmedHelper(list[2]!), false);
});

test("a helper label is the agent type and the brief after it", () => {
  assert.deepEqual(helperLabel(s("x", "idle", { agent: "explorer", title: "explorer · Map approvals" })), { agent: "explorer", brief: "Map approvals" });
  assert.deepEqual(helperLabel(s("x", "idle", { title: "Read it" })), { agent: "helper", brief: "Read it" });
  assert.deepEqual(helperLabel(s("x", "idle")), { agent: "helper", brief: "" });
});

test("a helper row says working, queued, asking or done", () => {
  assert.equal(helperRowState(s("x", "running")), "working");
  assert.equal(helperRowState(s("x", "running", { wait_reason: "slot" })), "queued");
  assert.equal(helperRowState(s("x", "waiting")), "asking");
  assert.equal(helperRowState(s("x", "idle")), "done");
});

test("square and helper test", () => {
  assert.equal(helperSquare(s("x", "idle")), null);
  assert.equal(helperSquare(s("x", "weird")), null);
  assert.equal(isHelperSession({ parent_session_id: "p" }), true);
  assert.equal(isHelperSession({}), false);
});

test("words say how many helpers do what", () => {
  assert.equal(helperWords([]), null);
  assert.equal(helperWords(["working", "working"]), "2 helpers working");
  assert.equal(helperWords(["asking"]), "1 helper asks you");
  assert.equal(helperWords(["working", "queued", "asking", "asking"]), "1 helper working, 1 helper queued, 2 helpers ask you");
});

test("helperCountWords words a lead's counts", () => {
  assert.equal(helperCountWords(2, 1), "2 helpers working, 1 helper asks you");
  assert.equal(helperCountWords(1, null), "1 helper working");
  assert.equal(helperCountWords(0, undefined), null);
});
