import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { readThinkingMode, setThinkingMode, thinkingModeStore, THINKING_KEY, useThinkingMode } from "./thinking-shown.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  thinkingModeStore.set("collapsed");
});

test("with nothing stored the thinking line is collapsed", () => {
  localStorage.clear();
  expect(readThinkingMode()).toBe("collapsed");
});

test("the old word shown reads as Collapsed, and hidden and open read as themselves", () => {
  localStorage.setItem(THINKING_KEY, "shown");
  expect(readThinkingMode()).toBe("collapsed");
  localStorage.setItem(THINKING_KEY, "hidden");
  expect(readThinkingMode()).toBe("hidden");
  localStorage.setItem(THINKING_KEY, "open");
  expect(readThinkingMode()).toBe("open");
  localStorage.setItem(THINKING_KEY, "banana");
  expect(readThinkingMode()).toBe("collapsed");
});

test("storage that throws on read means collapsed", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readThinkingMode()).toBe("collapsed");
});

test("the hook follows the choice, stores it, and survives storage that throws on write", () => {
  const view = renderHook(() => useThinkingMode());
  act(() => setThinkingMode("hidden"));
  expect(view.result.current).toBe("hidden");
  expect(localStorage.getItem(THINKING_KEY)).toBe("hidden");
  act(() => setThinkingMode("collapsed"));
  expect(localStorage.getItem(THINKING_KEY)).toBe("shown");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  act(() => setThinkingMode("open"));
  expect(view.result.current).toBe("open");
});
