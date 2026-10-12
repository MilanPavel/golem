import assert from "node:assert/strict";
import { test } from "node:test";

import { LOGO_ROWS, LOGO_WIDTH, logoPixels, logoRows, type LogoTone } from "./logo.ts";

test("the mark is the gridded clay figure", () => {
  assert.equal(LOGO_ROWS, 7);
  assert.equal(LOGO_WIDTH, 18);
  assert.equal(logoPixels.length, LOGO_ROWS * 2);
  for (const row of logoPixels) {
    assert.equal(row.length, LOGO_WIDTH);
    for (let x = 0; x < LOGO_WIDTH; x += 1) {
      const left: LogoTone | null = row[x] ?? null;
      const mirrored: LogoTone | null = row[LOGO_WIDTH - 1 - x] ?? null;
      assert.equal(left === null, mirrored === null);
      if (left === "eye" || mirrored === "eye") {
        assert.equal(left, mirrored);
      }
      if (left === "highlight") {
        assert.equal(mirrored, "shadow");
      }
      if (left === "body") {
        assert.equal(mirrored, "body");
      }
    }
  }
  for (const line of logoRows) {
    const width = line.reduce((sum, run) => sum + run.text.length, 0);
    assert.equal(width, LOGO_WIDTH);
  }
});

test("the forehead dot sits above two slanted eyes", () => {
  assert.equal(logoPixels[2]?.[8], "eye");
  assert.equal(logoPixels[2]?.[9], "eye");
  assert.equal(logoPixels[3]?.[8], "body");
  assert.equal(logoPixels[4]?.[5], "eye");
  assert.equal(logoPixels[5]?.[5], "body");
  assert.equal(logoPixels[4]?.[8], "body");
  assert.equal(logoPixels[0]?.[7], "highlight");
  assert.equal(logoPixels[13]?.[1], "shadow");
  assert.ok(logoRows.some((line) => line.some((run) => run.color === "eye" && run.background === "body")));
});
