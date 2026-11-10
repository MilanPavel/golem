import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { readThinkingShown, setThinkingShown, thinkingShownStore, THINKING_KEY, useThinkingShown } from "./thinking-shown.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  thinkingShownStore.set(true);
});

test("with nothing stored the thinking line is shown", () => {
  localStorage.clear();
  expect(readThinkingShown()).toBe(true);
});

test("a stored hidden choice hides it, and other values are ignored", () => {
  localStorage.setItem(THINKING_KEY, "hidden");
  expect(readThinkingShown()).toBe(false);
  localStorage.setItem(THINKING_KEY, "banana");
  expect(readThinkingShown()).toBe(true);
});

test("storage that throws on read means shown", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readThinkingShown()).toBe(true);
});

test("the hook follows the choice, stores it, and survives storage that throws on write", () => {
  const view = renderHook(() => useThinkingShown());
  act(() => setThinkingShown(false));
  expect(view.result.current).toBe(false);
  expect(localStorage.getItem(THINKING_KEY)).toBe("hidden");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  act(() => setThinkingShown(true));
  expect(view.result.current).toBe(true);
});
