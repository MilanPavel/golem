import assert from "node:assert/strict";
import { test } from "node:test";

import { isRoutineSession, isWaiting, originLabel, routineName } from "./origin.ts";

test("a routine origin gives the routine's name and its label", () => {
  assert.equal(routineName({ origin: "routine:digest" }), "digest");
  assert.equal(isRoutineSession({ origin: "routine:digest" }), true);
  assert.equal(originLabel({ origin: "routine:digest" }), "routine digest");
});

test("a routine origin without a name is still a routine", () => {
  assert.equal(routineName({ origin: "routine:" }), null);
  assert.equal(isRoutineSession({ origin: "routine:" }), true);
  assert.equal(originLabel({ origin: "routine:" }), "routine");
});

test("the user's own sessions have no label", () => {
  for (const origin of [undefined, null, "", "user", "cli"]) {
    assert.equal(originLabel({ origin }), null);
    assert.equal(isRoutineSession({ origin }), false);
    assert.equal(routineName({ origin }), null);
  }
});

test("another origin is its own label and not a routine", () => {
  assert.equal(originLabel({ origin: "webhook:push" }), "webhook:push");
  assert.equal(isRoutineSession({ origin: "webhook:push" }), false);
});

test("waiting is the waiting status only", () => {
  assert.equal(isWaiting({ status: "waiting" }), true);
  assert.equal(isWaiting({ status: "running" }), false);
  assert.equal(isWaiting({}), false);
});
