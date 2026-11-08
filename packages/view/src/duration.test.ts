import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDuration, formatElapsed } from "./duration.ts";

test("a duration reads as minutes and seconds", () => {
  const rows: [number, string][] = [
    [0, "0m 00.000s"],
    [4, "0m 00.004s"],
    [999, "0m 00.999s"],
    [1000, "0m 01.0s"],
    [4200, "0m 04.2s"],
    [14_869, "0m 14.9s"],
    [59_960, "1m 00.0s"],
    [150_800, "2m 30.8s"],
    [724_200, "12m 04.2s"],
    [3_723_000, "62m 03.0s"],
    [-1, ""],
    [Number.NaN, ""],
    [Number.POSITIVE_INFINITY, ""],
  ];
  for (const [ms, text] of rows) {
    assert.equal(formatDuration(ms), text, String(ms));
  }
});

test("a live counter shows whole seconds, rounded down", () => {
  const rows: [number, string][] = [
    [0, "0m 00s"],
    [999, "0m 00s"],
    [3000, "0m 03s"],
    [64_000, "1m 04s"],
    [720_000, "12m 00s"],
    [-5, "0m 00s"],
    [Number.NaN, "0m 00s"],
  ];
  for (const [ms, text] of rows) {
    assert.equal(formatElapsed(ms), text, String(ms));
  }
});
