import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  FOOTER_KEY,
  footerStore,
  readFooter,
  readSendKey,
  SEND_KEY_KEY,
  sendKeyStore,
  setFooter,
  setSendKey,
  useFooter,
} from "./chat-choices.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sendKeyStore.set("enter");
  footerStore.set({ off: [], leaveOutEmpty: true });
});

test("with nothing stored: the send key is enter, every part shows and what says nothing is left out", () => {
  expect(readSendKey()).toBe("enter");
  expect(readFooter()).toEqual({ off: [], leaveOutEmpty: true });
});

test("the old open-on-fail key is removed once on load", async () => {
  localStorage.setItem("golem.openOnFail", "off");
  vi.resetModules();
  await import("./chat-choices.ts");
  expect(localStorage.getItem("golem.openOnFail")).toBeNull();
});

test("the send key is kept", () => {
  setSendKey("mod");
  expect(localStorage.getItem(SEND_KEY_KEY)).toBe("mod");
  expect(readSendKey()).toBe("mod");
  localStorage.setItem(SEND_KEY_KEY, "banana");
  expect(readSendKey()).toBe("enter");
});

test("the footer is kept, and unreadable values mean the default", () => {
  const view = renderHook(() => useFooter());
  act(() => setFooter({ off: ["tokens"], leaveOutEmpty: false }));
  expect(view.result.current).toEqual({ off: ["tokens"], leaveOutEmpty: false });
  expect(readFooter()).toEqual({ off: ["tokens"], leaveOutEmpty: false });
  localStorage.setItem(FOOTER_KEY, "{not json");
  expect(readFooter()).toEqual({ off: [], leaveOutEmpty: true });
  localStorage.setItem(FOOTER_KEY, JSON.stringify({ off: ["cost", "banana", 3] }));
  expect(readFooter()).toEqual({ off: ["cost"], leaveOutEmpty: true });
  localStorage.setItem(FOOTER_KEY, "7");
  expect(readFooter()).toEqual({ off: [], leaveOutEmpty: true });
});

test("storage that throws is the default on read, and a choice still lasts on write", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  expect(readSendKey()).toBe("enter");
  expect(readFooter()).toEqual({ off: [], leaveOutEmpty: true });
  setSendKey("mod");
  expect(sendKeyStore.getSnapshot()).toBe("mod");
});
