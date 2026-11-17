import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseTarget, readOpenIn, terminalArgs } from "./open-target.ts";

test("web with the web job installed opens the session page", () => {
  assert.deepEqual(chooseTarget("abc", "web", true), { kind: "web", path: "/s/abc" });
});

test("terminal opens the chat on the session", () => {
  assert.deepEqual(chooseTarget("abc", "terminal", true), { kind: "terminal", sessionId: "abc", args: ["open", "abc"] });
});

test("web with no web job falls back to the terminal", () => {
  assert.deepEqual(chooseTarget("abc", "web", false), { kind: "terminal", sessionId: "abc", args: ["open", "abc"] });
});

test("an id is encoded in the page address and kept as is in the terminal arguments", () => {
  assert.deepEqual(chooseTarget("a b/c", "web", true), { kind: "web", path: "/s/a%20b%2Fc" });
  assert.deepEqual(terminalArgs("a b/c"), ["open", "a b/c"]);
});

test("the setting reads as web unless it says terminal", () => {
  assert.equal(readOpenIn("terminal"), "terminal");
  assert.equal(readOpenIn("web"), "web");
  assert.equal(readOpenIn(undefined), "web");
  assert.equal(readOpenIn(null), "web");
  assert.equal(readOpenIn("window"), "web");
});
