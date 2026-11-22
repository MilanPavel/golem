import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  FOOTER_KEY,
  footerStore,
  OPEN_ON_FAIL_KEY,
  openOnFailStore,
  readFooter,
  readOpenOnFail,
  readSendKey,
  SEND_KEY_KEY,
  sendKeyStore,
  setFooter,
  setOpenOnFail,
  setSendKey,
  useFooter,
} from "./chat-choices.ts";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  openOnFailStore.set(true);
  sendKeyStore.set("enter");
  footerStore.set({ off: [], leaveOutEmpty: true });
});

test("with nothing stored: open on fail is on, the send key is enter, every part shows and what says nothing is left out", () => {
  expect(readOpenOnFail()).toBe(true);
  expect(readSendKey()).toBe("enter");
  expect(readFooter()).toEqual({ off: [], leaveOutEmpty: true });
});

test("open on fail is kept, and odd values mean the default", () => {
  setOpenOnFail(false);
  expect(localStorage.getItem(OPEN_ON_FAIL_KEY)).toBe("off");
  expect(readOpenOnFail()).toBe(false);
  localStorage.setItem(OPEN_ON_FAIL_KEY, "banana");
  expect(readOpenOnFail()).toBe(true);
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
  expect(readOpenOnFail()).toBe(true);
  expect(readSendKey()).toBe("enter");
  expect(readFooter()).toEqual({ off: [], leaveOutEmpty: true });
  setSendKey("mod");
  expect(sendKeyStore.getSnapshot()).toBe("mod");
});
