import assert from "node:assert/strict";
import { test } from "node:test";

import { statusLabel } from "./status-label.ts";

test("status bar text follows the connection", () => {
  assert.equal(statusLabel({ status: "connecting" }), "connecting");
  assert.equal(statusLabel({ status: "connected" }), "connected");
  assert.equal(
    statusLabel({ status: "reconnecting", attempt: 2, delayMs: 400 }),
    "reconnecting",
  );
  assert.equal(statusLabel({ status: "closed", reason: "closed" }), "closed");
  assert.equal(
    statusLabel({ status: "rejected", reason: "protocol major mismatch: client 1, daemon 9" }),
    "protocol major mismatch: client 1, daemon 9",
  );
});
