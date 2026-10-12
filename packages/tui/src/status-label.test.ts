import assert from "node:assert/strict";
import { test } from "node:test";

import { fitStatus, modelChip, preferModel, shortCwd, statusLabel } from "./status-label.ts";

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

test("the model chip prefers a name and profile, then either one", () => {
  assert.equal(modelChip("qwen3.5:4b", "remote"), "qwen3.5:4b · remote");
  assert.equal(modelChip(null, "remote"), "remote");
  assert.equal(modelChip("qwen3.5:4b", null), "qwen3.5:4b");
  assert.equal(modelChip(null, null), "");
});

test("a session model wins, and a missing name falls back to the daemon", () => {
  const daemon = { profile: "remote", provider: "openai_compat", name: "qwen3.5:4b" };
  assert.deepEqual(preferModel(null, daemon), daemon);
  assert.deepEqual(
    preferModel({ profile: "local", provider: null, name: null }, daemon),
    { profile: "local", provider: "openai_compat", name: "qwen3.5:4b" },
  );
});

test("the working directory is shortened against home", () => {
  assert.equal(shortCwd("/Users/milan.pavel/repos/golem", "/Users/milan.pavel"), "~/repos/golem");
  assert.equal(shortCwd("/tmp", "/Users/milan.pavel"), "/tmp");
});

test("the status line keeps the connection and drops the directory when it does not fit", () => {
  const fitted = fitStatus(
    { connection: "connected", model: "qwen3.5:4b · remote", cwd: "~/repos/golem" },
    24,
  );
  assert.equal(fitted.connection, "connected");
  assert.equal(fitted.cwd, "");
  assert.ok(fitted.model.length > 0);
});
