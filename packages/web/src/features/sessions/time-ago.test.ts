import { expect, test } from "vitest";
import { folderName } from "./folder.ts";
import { timeAgo } from "./time-ago.ts";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

test.each([
  [0, "now"],
  [59_000, "now"],
  [2 * MIN, "2m"],
  [59 * MIN, "59m"],
  [3 * 60 * MIN, "3h"],
  [23 * 60 * MIN, "23h"],
  [5 * 24 * 60 * MIN, "5d"],
  [6 * 24 * 60 * MIN + 23 * 60 * MIN, "6d"],
])("%d ms ago is %s", (ms, text) => {
  expect(timeAgo(ago(ms), NOW)).toBe(text);
});

test("a week or more is a short date, with the year only when it differs", () => {
  expect(timeAgo("2026-10-20T08:00:00Z", NOW)).toMatch(/^Oct 20$/);
  expect(timeAgo("2025-03-04T12:00:00Z", NOW)).toMatch(/^Mar 4, 2025$/);
});

test("a time in the future is now, and an unreadable one is empty", () => {
  expect(timeAgo(ago(-5 * MIN), NOW)).toBe("now");
  expect(timeAgo("not a date", NOW)).toBe("");
});

test("folderName is the last path part", () => {
  expect(folderName("/Users/you/repos/golem")).toBe("golem");
  expect(folderName("/Users/you/repos/golem/")).toBe("golem");
  expect(folderName("/")).toBe("/");
  expect(folderName(null)).toBe("No folder");
});
