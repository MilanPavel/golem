import { afterEach, expect, test, vi } from "vitest";
import { applyTheme, readTheme } from "./theme.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

test("the default is the system", () => {
  expect(readTheme()).toBe("system");
});

test("a chosen theme is set on the page and remembered", () => {
  applyTheme("kiln");
  expect(document.documentElement.getAttribute("data-theme")).toBe("kiln");
  expect(readTheme()).toBe("kiln");
  applyTheme("slip");
  expect(document.documentElement.getAttribute("data-theme")).toBe("slip");
  expect(readTheme()).toBe("slip");
});

test("system removes the attribute and the stored choice", () => {
  applyTheme("kiln");
  applyTheme("system");
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(readTheme()).toBe("system");
});

test("an unknown stored value reads as system", () => {
  localStorage.setItem("golem.theme", "neon");
  expect(readTheme()).toBe("system");
});

test("blocked storage falls back to system and does not throw", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readTheme()).toBe("system");
  expect(() => applyTheme("kiln")).not.toThrow();
  expect(document.documentElement.getAttribute("data-theme")).toBe("kiln");
});
