import { expect, test } from "vitest";
import { overallState } from "./overall-state.ts";

const s = (status: string) => ({ status });

test("offline wins over everything", () => {
  expect(overallState(false, [s("waiting"), s("running")])).toBe("offline");
});

test("waiting beats running", () => {
  expect(overallState(true, [s("running"), s("waiting"), s("idle")])).toBe("waiting");
});

test("any running session means working", () => {
  expect(overallState(true, [s("idle"), s("running")])).toBe("thinking");
});

test("idle, and idle with no sessions", () => {
  expect(overallState(true, [s("idle"), s("closed")])).toBe("idle");
  expect(overallState(true, [])).toBe("idle");
});
