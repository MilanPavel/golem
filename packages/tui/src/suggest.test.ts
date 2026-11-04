import assert from "node:assert/strict";
import { test } from "node:test";

import { moveSuggestion, suggestionWindow } from "./suggest.ts";

test("the selection stops at the ends and stays on screen", () => {
  assert.equal(moveSuggestion(0, "up", 4), 0);
  assert.equal(moveSuggestion(0, "down", 4), 1);
  assert.equal(moveSuggestion(3, "down", 4), 3);
  assert.deepEqual(suggestionWindow(10, 0, 6), { start: 0, index: 0 });
  assert.deepEqual(suggestionWindow(10, 6, 6), { start: 1, index: 6 });
  assert.deepEqual(suggestionWindow(3, 2, 6), { start: 0, index: 2 });
});
