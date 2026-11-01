import assert from "node:assert/strict";
import { test } from "node:test";

import { connectionLabel } from "./connection.ts";

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
