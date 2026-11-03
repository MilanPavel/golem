import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DRAWER_KEY, drawerOpenStore, readDrawerOpen, useDrawerOpen } from "./drawer-open.ts";

function wide(matches: boolean | "missing") {
  if (matches === "missing") {
    vi.stubGlobal("matchMedia", undefined);
  } else {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query }));
  }
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  drawerOpenStore.set(false);
});

test("with nothing stored, a wide window opens it and a narrow one does not", () => {
  wide(true);
  expect(readDrawerOpen()).toBe(true);
  wide(false);
  expect(readDrawerOpen()).toBe(false);
});

test("without matchMedia it is closed", () => {
  wide("missing");
  expect(readDrawerOpen()).toBe(false);
});

test("the stored choice wins over the width", () => {
  wide(true);
  localStorage.setItem(DRAWER_KEY, "closed");
  expect(readDrawerOpen()).toBe(false);
  wide(false);
  localStorage.setItem(DRAWER_KEY, "open");
  expect(readDrawerOpen()).toBe(true);
});

test("an unknown stored value is ignored", () => {
  wide(true);
  localStorage.setItem(DRAWER_KEY, "banana");
  expect(readDrawerOpen()).toBe(true);
});

test("storage that throws on read falls back to the width", () => {
  wide(true);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readDrawerOpen()).toBe(true);
});

test("the hook shares one choice, stores it, and still works when storage throws on write", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  const first = renderHook(() => useDrawerOpen());
  const second = renderHook(() => useDrawerOpen());
  act(() => first.result.current[1](true));
  expect(second.result.current[0]).toBe(true);
  vi.restoreAllMocks();
  act(() => second.result.current[1](false));
  expect(first.result.current[0]).toBe(false);
  expect(localStorage.getItem(DRAWER_KEY)).toBe("closed");
  act(() => first.result.current[1](true));
  expect(localStorage.getItem(DRAWER_KEY)).toBe("open");
});
