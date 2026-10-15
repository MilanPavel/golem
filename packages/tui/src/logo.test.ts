import assert from "node:assert/strict";
import { test } from "node:test";

import { LOGO_ROWS, LOGO_WIDTH, logoPixels, logoRows } from "./logo.ts";

test("the mark is a symmetric clay figure", () => {
  assert.equal(LOGO_ROWS, 3);
  assert.equal(LOGO_WIDTH, 9);
  assert.equal(logoPixels.length, LOGO_ROWS * 2);
  for (const row of logoPixels) {
    assert.equal(row.length, LOGO_WIDTH);
    assert.deepEqual(row, [...row].reverse());
  }
  for (const line of logoRows) {
    const width = line.reduce((sum, run) => sum + run.text.length, 0);
    assert.equal(width, LOGO_WIDTH);
  }
});

test("a block head with two eyes on broad shoulders, arms hanging, two legs", () => {
  assert.deepEqual(logoPixels[1]?.slice(2, 7), ["body", "eye", "body", "eye", "body"]);
  assert.equal(logoPixels[0]?.[2], null);
  assert.equal(logoPixels[1]?.[2], "body");
  assert.equal(logoPixels[2]?.[0], "body");
  assert.equal(logoPixels[3]?.[1], null);
  assert.equal(logoPixels[5]?.[4], null);
  assert.equal(logoPixels[5]?.[0], null);
  assert.ok(logoRows[0]?.some((run) => run.color === "body" && run.background === "eye"));
});
