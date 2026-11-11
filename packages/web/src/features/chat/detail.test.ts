import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DETAIL_KEY, detailStore, readDetail, setDetail, useDetail } from "./detail.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  detailStore.set("normal");
});

test("with nothing stored the detail is normal", () => {
  expect(readDetail()).toBe("normal");
});

test("a stored level is read, and other values are ignored", () => {
  localStorage.setItem(DETAIL_KEY, "verbose");
  expect(readDetail()).toBe("verbose");
  localStorage.setItem(DETAIL_KEY, "banana");
  expect(readDetail()).toBe("normal");
});

test("storage that throws on read means normal", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readDetail()).toBe("normal");
});

test("the hook follows the choice, stores it, and survives storage that throws on write", () => {
  const view = renderHook(() => useDetail());
  act(() => setDetail("quiet"));
  expect(view.result.current).toBe("quiet");
  expect(localStorage.getItem(DETAIL_KEY)).toBe("quiet");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  act(() => setDetail("verbose"));
  expect(view.result.current).toBe("verbose");
});
