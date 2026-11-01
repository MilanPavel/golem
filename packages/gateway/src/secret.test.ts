import assert from "node:assert/strict";
import { test } from "node:test";

import { randomSecret, timingSafeEqual } from "./core.ts";

test("randomSecret is 43 base64url characters", () => {
  assert.match(randomSecret(), /^[A-Za-z0-9_-]{43}$/);
});

test("randomSecret does not repeat", () => {
  assert.equal(new Set(Array.from({ length: 200 }, randomSecret)).size, 200);
});

test("timingSafeEqual: equal strings", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("", ""), true);
});

test("timingSafeEqual: different strings of one length", () => {
  assert.equal(timingSafeEqual("abc", "abd"), false);
});

test("timingSafeEqual: different lengths", () => {
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", "a"), false);
});

test("timingSafeEqual: multi-byte characters", () => {
  assert.equal(timingSafeEqual("héllo✓", "héllo✓"), true);
  assert.equal(timingSafeEqual("héllo✓", "hello✓"), false);
  // Same character count, different byte length.
  assert.equal(timingSafeEqual("é", "e"), false);
});
