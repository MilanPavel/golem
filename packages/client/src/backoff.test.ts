import assert from "node:assert/strict";
import { test } from "node:test";

import { backoffDelayMs } from "./backoff.ts";

test("full jitter stays under the attempt ceiling", () => {
  assert.equal(backoffDelayMs(1, () => 0), 0);
  assert.equal(backoffDelayMs(1, () => 0.999), 199);
  assert.equal(backoffDelayMs(2, () => 0.999), 399);
  assert.equal(backoffDelayMs(3, () => 1), 800);
});

test("backoff caps at five seconds", () => {
  assert.equal(backoffDelayMs(6, () => 0.5), 2_500);
  assert.equal(backoffDelayMs(20, () => 0.999), 4_995);
});
