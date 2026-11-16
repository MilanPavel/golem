import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("./sidebar-width.ts");
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("the constants match the layout contract", async () => {
  const m = await load();
  expect([m.SIDEBAR_DEFAULT, m.SIDEBAR_MIN, m.SIDEBAR_MAX, m.SIDEBAR_STEP, m.COLLAPSE_BELOW]).toEqual([16.75, 12.5, 26.25, 1, 9.375]);
  expect(m.SIDEBAR_WIDTH_KEY).toBe("golem.sidebar.width");
});

test("the default with nothing stored", async () => {
  const m = await load();
  expect(m.sidebarWidthStore.getSnapshot()).toBe(16.75);
});

test("clamp keeps the width within the limits", async () => {
  const m = await load();
  expect(m.clampSidebarWidth(1)).toBe(12.5);
  expect(m.clampSidebarWidth(99)).toBe(26.25);
  expect(m.clampSidebarWidth(20)).toBe(20);
});

test("a stored value is used on load, and clamped", async () => {
  localStorage.setItem("golem.sidebar.width", "20");
  expect((await load()).sidebarWidthStore.getSnapshot()).toBe(20);
  localStorage.setItem("golem.sidebar.width", "99");
  expect((await load()).sidebarWidthStore.getSnapshot()).toBe(26.25);
});

test.each(["abc", "", "-3", "0", "Infinity"])("a bad stored value (%j) gives the default", async (bad) => {
  localStorage.setItem("golem.sidebar.width", bad);
  expect((await load()).sidebarWidthStore.getSnapshot()).toBe(16.75);
});

test("the hook sets, clamps and stores the width", async () => {
  const m = await load();
  const { result } = renderHook(() => m.useSidebarWidth());
  act(() => result.current[1](22));
  expect(result.current[0]).toBe(22);
  expect(localStorage.getItem("golem.sidebar.width")).toBe("22");
  act(() => result.current[1](1));
  expect(result.current[0]).toBe(12.5);
});

test("blocked storage does not throw", async () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  });
  const m = await load();
  expect(m.sidebarWidthStore.getSnapshot()).toBe(16.75);
  const { result } = renderHook(() => m.useSidebarWidth());
  act(() => result.current[1](20));
  expect(result.current[0]).toBe(20);
});
