import assert from "node:assert/strict";
import { test } from "node:test";

import { explainDaemonDown, isDaemonDown } from "./daemon-down.ts";

const refused = "connect ECONNREFUSED /Users/me/.golem/run/golem.sock";
const missing = "connect ENOENT /Users/me/.golem/run/golem.sock";

test("no launch agent means install", () => {
  assert.equal(
    explainDaemonDown(missing, null, false),
    `daemon is not running (${missing})\nrun: golem daemon install`,
  );
});

test("a launch agent that is not running means start", () => {
  assert.equal(
    explainDaemonDown(refused, null, true),
    `daemon is not running (${refused})\nrun: golem daemon start`,
  );
});

test("a daemon that never answered means restart", () => {
  assert.match(explainDaemonDown("hello timed out after 2000 ms", null, true), /\nrun: golem daemon restart$/);
  assert.match(explainDaemonDown("hello timed out after 2000 ms", null, false), /\nrun: golem daemon install$/);
});

test("a start error the daemon wrote wins over the connection error", () => {
  const tooNew = { reason: "your data is from golem 0.9.0, this is 0.4.0", next: "brew upgrade golem" };
  assert.equal(
    explainDaemonDown(refused, tooNew, true),
    "golem can't start: your data is from golem 0.9.0, this is 0.4.0\nnext: brew upgrade golem",
  );
  assert.equal(explainDaemonDown(refused, { reason: "it broke", next: "" }, false), "golem can't start: it broke");
});

test("only connection errors count as a daemon that is down", () => {
  assert.ok(isDaemonDown(refused));
  assert.ok(isDaemonDown(missing));
  assert.ok(isDaemonDown("hello timed out after 2000 ms"));
  assert.ok(!isDaemonDown("unknown provider: nope"));
});
