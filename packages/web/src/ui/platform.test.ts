import { afterEach, expect, test, vi } from "vitest";
import { hasMod, isMac, modShortcut } from "./platform.ts";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "userAgentData");
});

test("elsewhere the command key is Ctrl", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  expect(isMac()).toBe(false);
  expect(modShortcut("K")).toBe("Ctrl K");
  expect(hasMod({ metaKey: false, ctrlKey: true })).toBe(true);
  expect(hasMod({ metaKey: true, ctrlKey: false })).toBe(false);
});

test("on macOS it is the command key", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  expect(isMac()).toBe(true);
  expect(modShortcut("K")).toBe("⌘K");
  expect(hasMod({ metaKey: true, ctrlKey: false })).toBe(true);
  expect(hasMod({ metaKey: false, ctrlKey: true })).toBe(false);
});

test("userAgentData wins over the older platform string", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  Object.defineProperty(navigator, "userAgentData", { value: { platform: "macOS" }, configurable: true });
  expect(isMac()).toBe(true);
});
