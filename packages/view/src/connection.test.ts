import assert from "node:assert/strict";
import { test } from "node:test";

import { connectionLabel, serviceProblem } from "./connection.ts";

test("the word follows the connection status", () => {
  assert.equal(connectionLabel({ status: "connecting" }), "connecting");
  assert.equal(connectionLabel({ status: "connected" }), "connected");
  assert.equal(connectionLabel({ status: "reconnecting", attempt: 2, delayMs: 400 }), "reconnecting");
  assert.equal(connectionLabel({ status: "closed", reason: "closed" }), "closed");
  assert.equal(connectionLabel({ status: "unauthorized" }), "unauthorized");
});

test("a refusal says why", () => {
  assert.equal(
    connectionLabel({ status: "rejected", reason: "protocol major mismatch: client 1, daemon 9" }),
    "protocol major mismatch: client 1, daemon 9",
  );
});

const down = { status: "reconnecting", attempt: 3, delayMs: 800 } as const;
const tooNew = { reason: "your data is from golem 0.6, this is 0.4", next: "brew upgrade golem" };

test("a start error the daemon wrote is shown with its next step, and r does not restart", () => {
  assert.deepEqual(serviceProblem(down, tooNew, true), {
    text: "golem can't start: your data is from golem 0.6, this is 0.4 · brew upgrade golem",
    restart: false,
  });
  assert.deepEqual(serviceProblem(down, { reason: "it broke", next: "" }, false), {
    text: "golem can't start: it broke",
    restart: false,
  });
});

test("an installed service that does not answer offers r", () => {
  assert.deepEqual(serviceProblem(down, null, true), {
    text: "golem's service isn't answering · r restart · golem daemon logs",
    restart: true,
  });
});

test("nothing is said while connected, while the first try runs, or with no service", () => {
  assert.equal(serviceProblem({ status: "connected" }, tooNew, true), null);
  assert.equal(serviceProblem({ status: "connecting" }, tooNew, true), null);
  assert.equal(serviceProblem(down, null, false), null);
});
