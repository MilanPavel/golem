import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

async function load() {
  vi.resetModules();
  return import("./sidebar-open.ts");
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("nothing is stored until the user chooses", async () => {
  const m = await load();
  expect(m.sidebarOpenStore.getSnapshot()).toBeNull();
  const { result } = renderHook(() => m.useSidebarOpen());
  expect(result.current[0]).toBeNull();
  expect(localStorage.getItem("golem.sidebar.open")).toBeNull();
});

test("choosing stores 1 or 0", async () => {
  const m = await load();
  const { result } = renderHook(() => m.useSidebarOpen());
  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
  expect(localStorage.getItem("golem.sidebar.open")).toBe("1");
  act(() => result.current[1](false));
  expect(result.current[0]).toBe(false);
  expect(localStorage.getItem("golem.sidebar.open")).toBe("0");
});

test("a stored value is used on load", async () => {
  localStorage.setItem("golem.sidebar.open", "1");
  expect((await load()).sidebarOpenStore.getSnapshot()).toBe(true);
  localStorage.setItem("golem.sidebar.open", "0");
  expect((await load()).sidebarOpenStore.getSnapshot()).toBe(false);
});

test.each(["yes", "", "true", "2"])("a bad stored value (%j) means no choice", async (bad) => {
  localStorage.setItem("golem.sidebar.open", bad);
  expect((await load()).sidebarOpenStore.getSnapshot()).toBeNull();
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
  expect(m.sidebarOpenStore.getSnapshot()).toBeNull();
  const { result } = renderHook(() => m.useSidebarOpen());
  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
});
