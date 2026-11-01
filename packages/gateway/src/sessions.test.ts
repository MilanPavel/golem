import assert from "node:assert/strict";
import { test } from "node:test";

import { createSessionStore } from "./core.ts";

test("a minted secret is valid, an unknown one is not", () => {
  const s = createSessionStore();
  const secret = s.mint();
  assert.equal(s.valid(secret), true);
  assert.equal(s.valid("nope"), false);
  assert.equal(s.valid(""), false);
});

test("a secret expires after maxAgeMs", () => {
  let t = 1000;
  const s = createSessionStore({ now: () => t, maxAgeMs: 100 });
  const secret = s.mint();
  t = 1099;
  assert.equal(s.valid(secret), true);
  t = 1100;
  assert.equal(s.valid(secret), false);
});

test("a new store knows no secret of an old one", () => {
  const secret = createSessionStore().mint();
  assert.equal(createSessionStore().valid(secret), false);
});

test("the max cap drops the oldest secret", () => {
  const s = createSessionStore({ max: 2 });
  const a = s.mint();
  const b = s.mint();
  const c = s.mint();
  assert.equal(s.valid(a), false);
  assert.equal(s.valid(b), true);
  assert.equal(s.valid(c), true);
});

test("minted secrets differ", () => {
  const s = createSessionStore();
  assert.notEqual(s.mint(), s.mint());
});
