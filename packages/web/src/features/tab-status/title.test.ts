import { expect, test } from "vitest";
import type { GolemState } from "../../ui/golem-state.ts";
import { tabTitle } from "./title.ts";

const MARKS: [GolemState, string][] = [
  ["idle", ""],
  ["thinking", "● "],
  ["waiting", "! "],
  ["failed", "✗ "],
  ["offline", "○ "],
];

test.each(MARKS)("%s puts its mark before the title", (state, mark) => {
  expect(tabTitle(state, "Fix the login bug")).toBe(`${mark}Fix the login bug · golem`);
  expect(tabTitle(state, null)).toBe(`${mark}golem`);
});

test.each(MARKS)("%s with an empty or untitled name is just golem", (state, mark) => {
  expect(tabTitle(state, "")).toBe(`${mark}golem`);
  expect(tabTitle(state, "   ")).toBe(`${mark}golem`);
  expect(tabTitle(state, "untitled")).toBe(`${mark}golem`);
  expect(tabTitle(state, " untitled ")).toBe(`${mark}golem`);
});

test("control characters are removed from the title", () => {
  expect(tabTitle("idle", "a\nb\u0000c\u0007\u009fd")).toBe("abcd · golem");
  expect(tabTitle("idle", "\n\t")).toBe("golem");
});
