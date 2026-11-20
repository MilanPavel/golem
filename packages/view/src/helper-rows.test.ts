import assert from "node:assert/strict";
import { test } from "node:test";

import { groupHelpers, helperSquare, helperWords, isHelperSession, type HelperSession } from "./helper-rows.ts";

function s(id: string, status: string, extra: Partial<HelperSession> = {}): HelperSession {
  return { session_id: id, status, ...extra };
}

const LEAD = s("lead", "running");

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

test("show helpers brings the helper rows back and keeps the squares", () => {
  const list = [LEAD, s("h1", "running", { parent_session_id: "lead" })];
  const { rows, squares } = groupHelpers(list, { showHelpers: true });
  assert.deepEqual(rows.map((r) => r.session_id), ["lead", "h1"]);
  assert.deepEqual(squares.get("lead"), ["working"]);
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
