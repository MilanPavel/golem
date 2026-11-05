import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTipCount, tipAt, TIPS } from "./tips.ts";

test("each session number gets the next tip, and the list starts over", () => {
  assert.equal(tipAt(0), TIPS[0]);
  assert.equal(tipAt(1), TIPS[1]);
  assert.notEqual(tipAt(0), tipAt(1));
  assert.equal(tipAt(TIPS.length), TIPS[0]);
  assert.equal(tipAt(-3), TIPS[0]);
  assert.equal(tipAt(Number.NaN), TIPS[0]);
});

test("the first tip names /mcp add, and the tips name /mcp, /skills, ? and /sessions", () => {
  assert.equal(TIPS[0], "Tip: /mcp add connects tools such as GitHub");
  for (const word of ["/mcp", "/skills", "?", "/sessions"]) {
    assert.ok(
      TIPS.some((tip) => tip.includes(word)),
      word,
    );
  }
});

test("a stored count that is missing or not a number counts as 0", () => {
  assert.equal(parseTipCount("3\n"), 3);
  assert.equal(parseTipCount(""), 0);
  assert.equal(parseTipCount("x"), 0);
  assert.equal(parseTipCount("-2"), 0);
  assert.equal(parseTipCount("99999999999999999999"), 0);
});
