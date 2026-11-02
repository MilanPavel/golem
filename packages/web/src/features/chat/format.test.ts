import { expect, test } from "vitest";
import { formatClock, formatDuration, shouldStick, squeezeArgs } from "./format.ts";

test("durations read 4.2s under a minute and 1m 03s after", () => {
  expect(formatDuration(4200)).toBe("4.2s");
  expect(formatDuration(0)).toBe("0.0s");
  expect(formatDuration(63_000)).toBe("1m 03s");
  expect(formatDuration(59_990)).toBe("1m 00s");
  expect(formatDuration(600_000)).toBe("10m 00s");
  expect(formatDuration(-1)).toBe("");
  expect(formatDuration(Number.NaN)).toBe("");
});

test("the clock is two digits each", () => {
  expect(formatClock("2026-11-01T09:05:00")).toBe("09:05");
  expect(formatClock(undefined)).toBe("");
  expect(formatClock("nope")).toBe("");
});

test("arguments squeeze to one line", () => {
  expect(squeezeArgs({ command: "ls\n  -la" })).toBe("ls -la");
  expect(squeezeArgs({ path: "a", n: 2 })).toBe('{"path":"a","n":2}');
  expect(squeezeArgs({})).toBe("");
});

test("shouldStick: at the bottom or within a few pixels sticks, scrolled up does not", () => {
  expect(shouldStick(600, 1000, 400)).toBe(true);
  expect(shouldStick(590, 1000, 400)).toBe(true);
  expect(shouldStick(500, 1000, 400)).toBe(false);
  expect(shouldStick(0, 300, 400)).toBe(true);
});
