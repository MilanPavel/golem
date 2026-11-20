import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { closeHelper, closeHelperNotOf, closeHelperOf, openHelper, useHelperOpen } from "./helper-open.ts";

afterEach(closeHelper);

test("a helper opened for a chat survives leaving the chat before it, and closes when that chat is left", () => {
  const hook = renderHook(() => useHelperOpen());
  act(() => {
    openHelper({ helperId: "h1", leadId: "lead" });
  });
  // Leaving the chat the user was in (b) for the lead: the helper stays.
  act(() => {
    closeHelperOf("b");
  });
  expect(hook.result.current?.helperId).toBe("h1");
  // Landing on a chat that is not its lead closes it.
  act(() => {
    closeHelperNotOf("c");
  });
  expect(hook.result.current).toBeNull();
  // One opened inside its own chat (no leadId) closes when that chat is left, and survives landing.
  act(() => {
    openHelper({ helperId: "h2", callId: "d1" });
  });
  act(() => {
    closeHelperNotOf("c");
  });
  expect(hook.result.current?.helperId).toBe("h2");
  act(() => {
    closeHelperOf("c");
  });
  expect(hook.result.current).toBeNull();
  // The lead's own chat left: it closes.
  act(() => {
    openHelper({ helperId: "h3", leadId: "lead" });
  });
  act(() => {
    closeHelperOf("lead");
  });
  expect(hook.result.current).toBeNull();
});
