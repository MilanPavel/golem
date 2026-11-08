import { expect, test } from "vitest";
import { formatClock, shouldStick, squeezeArgs } from "./format.ts";

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
