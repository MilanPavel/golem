import assert from "node:assert/strict";
import { test } from "node:test";

import { answerTarget, approvalAnswerForKey, approvalAnswerOptions, editedArgs, inboxAnswerOptions, parseArgs } from "./approval-args.ts";

test("only one JSON object is accepted", () => {
  assert.deepEqual(parseArgs('{"path": "b.py"}'), { ok: true, args: { path: "b.py" } });
  for (const text of ["[1]", "[]", "null", '"x"', "1", "{"]) {
    assert.equal(parseArgs(text).ok, false, text);
  }
});

test("the reasons name the problem", () => {
  const bad = parseArgs("{");
  assert.ok(!bad.ok && bad.error.startsWith("not JSON: "));
  assert.deepEqual(parseArgs("[]"), { ok: false, error: "the arguments must be one JSON object" });
});

test("arguments that were not changed are not edited", () => {
  const original = { path: "a.py", n: 1 };
  assert.equal(editedArgs(original, { ...original }), null);
  assert.deepEqual(editedArgs(original, { path: "b.py" }), { path: "b.py" });
});

test("a lead's own item keeps once, session, always, deny", () => {
  const options = approvalAnswerOptions({ helper: false });
  assert.deepEqual(options.map((o) => [o.key, o.decision]), [["enter", "allow"], ["s", "allow_session"], ["w", "allow_always"], ["d", "deny"]]);
});

test("a helper's item has this helper (h) and all helpers (t, batch), no always", () => {
  const options = approvalAnswerOptions({ helper: true, count: 5 });
  assert.deepEqual(options.map((o) => o.key), ["enter", "h", "t", "d"]);
  assert.deepEqual(approvalAnswerForKey(options, "H"), options[1]);
  assert.equal(options[2]!.label, "For all 5 helpers");
  assert.equal(options[2]!.decision, "allow");
  assert.equal(options[2]!.scope, "batch");
  assert.equal(options[1]!.decision, "allow_session");
  assert.equal(approvalAnswerForKey(options, "w"), null);
});

test("all helpers is offered only when two or more are in play", () => {
  assert.deepEqual(approvalAnswerOptions({ helper: true, count: 1 }).map((o) => o.key), ["enter", "h", "d"]);
  assert.deepEqual(approvalAnswerOptions({ helper: true, count: 1, siblings: 3 }).map((o) => o.key), ["enter", "h", "t", "d"]);
});

test("the keys of the dock and the terminal band do not collide with h and t", () => {
  const taken = ["enter", "s", "w", "e", "d", "a", "escape"];
  for (const option of approvalAnswerOptions({ helper: true, count: 2 })) {
    if (option.id === "helper" || option.id === "all-helpers") assert.equal(taken.includes(option.key), false);
  }
});

test("the answer goes to the helper's session for a helper's item", () => {
  const helper = { callId: "c", answerSessionId: "h1" };
  assert.deepEqual(answerTarget(helper), { sessionId: "h1", callId: "c" });
  assert.equal(answerTarget({ callId: null, answerSessionId: "x" }), null);
  assert.deepEqual(inboxAnswerOptions({ kind: "consent", callId: null, helper: null, count: 1 }), []);
  assert.equal(inboxAnswerOptions({ kind: "approval", callId: "c", helper: {}, count: 2 }).length, 4);
});
