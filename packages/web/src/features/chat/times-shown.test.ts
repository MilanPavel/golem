import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { readTimesShown, setTimesShown, timesShownStore, TIMES_KEY, useTimesShown } from "./times-shown.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  timesShownStore.set(true);
});

test("with nothing stored the times are shown", () => {
  localStorage.clear();
  expect(readTimesShown()).toBe(true);
});

test("a stored hidden choice hides them, and other values are ignored", () => {
  localStorage.setItem(TIMES_KEY, "hidden");
  expect(readTimesShown()).toBe(false);
  localStorage.setItem(TIMES_KEY, "banana");
  expect(readTimesShown()).toBe(true);
});

test("storage that throws on read means shown", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readTimesShown()).toBe(true);
});

test("the hook follows the choice, stores it, and survives storage that throws on write", () => {
  const view = renderHook(() => useTimesShown());
  act(() => setTimesShown(false));
  expect(view.result.current).toBe(false);
  expect(localStorage.getItem(TIMES_KEY)).toBe("hidden");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  act(() => setTimesShown(true));
  expect(view.result.current).toBe(true);
});
