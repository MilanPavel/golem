import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { Workbench, type WorkbenchTab } from "./workbench.tsx";
import { TAB_KEY, openChange, openWorkbench, tabStore, useRequestedChange } from "./workbench-state.ts";
import {
  WORKBENCH_DEFAULT,
  WORKBENCH_MAX,
  WORKBENCH_MIN,
  WORKBENCH_STEP,
  WORKBENCH_WIDTH_KEY,
  clampWorkbenchWidth,
  workbenchWidthStore,
} from "./workbench-width.ts";

const tabs: WorkbenchTab[] = [
  { id: "todos", label: "Todos", badge: "2/5", render: () => <p>todo content</p> },
  { id: "changes", label: "Changes", render: () => <p>changes content</p> },
];

beforeEach(() => {
  localStorage.clear();
  tabStore.set(null);
  workbenchWidthStore.set(WORKBENCH_DEFAULT);
});
afterEach(() => {
  drawerOpenStore.set(false);
});

test("it renders the tabs, the badge, and the first tab's content", () => {
  render(<Workbench tabs={tabs} onClose={() => {}} />);
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Todos2/5", "Changes"]);
  expect(screen.getByText("2/5")).toBeTruthy();
  expect(screen.getByText("todo content")).toBeTruthy();
});

test("clicking a tab shows its content and remembers it", async () => {
  render(<Workbench tabs={tabs} onClose={() => {}} />);
  await userEvent.click(screen.getByRole("tab", { name: "Changes" }));
  expect(screen.getByText("changes content")).toBeTruthy();
  expect(screen.queryByText("todo content")).toBeNull();
  expect(localStorage.getItem(TAB_KEY)).toBe("changes");
});

test("an unknown stored tab falls back to the first", () => {
  tabStore.set("gone");
  render(<Workbench tabs={tabs} onClose={() => {}} />);
  expect(screen.getByRole("tab", { name: /Todos/ }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("todo content")).toBeTruthy();
});

test("the header has the tabs and the close button, and no width button", () => {
  render(<Workbench tabs={tabs} onClose={() => {}} />);
  expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Hide details"]);
});

test("the separator resizes with the arrow keys, within its limits, and remembers the width", async () => {
  render(<Workbench tabs={tabs} onClose={() => {}} />);
  const panel = screen.getByRole("complementary", { name: "Details" });
  const handle = screen.getByRole("separator", { name: "Resize the details" });
  expect(panel.className).toContain("w-80");
  expect(panel.style.width).toBe("");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(WORKBENCH_DEFAULT));
  handle.focus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(WORKBENCH_DEFAULT + WORKBENCH_STEP));
  expect(panel.style.width).toBe(`${WORKBENCH_DEFAULT + WORKBENCH_STEP}rem`);
  expect(localStorage.getItem(WORKBENCH_WIDTH_KEY)).toBe(String(WORKBENCH_DEFAULT + WORKBENCH_STEP));
  await userEvent.keyboard("{Home}{ArrowRight}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(WORKBENCH_MIN));
  await userEvent.keyboard("{End}{ArrowLeft}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(WORKBENCH_MAX));
});

test("dragging the handle sets the width from the pointer", () => {
  render(<Workbench tabs={tabs} onClose={() => {}} />);
  const panel = screen.getByRole("complementary", { name: "Details" });
  panel.getBoundingClientRect = () => ({ right: 1000 }) as DOMRect;
  const handle = screen.getByRole("separator");
  fireEvent.pointerDown(handle, { pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 1000 - 30 * 16 });
  expect(panel.style.width).toBe("30rem");
  fireEvent.pointerUp(handle, { pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 1000 - 40 * 16 });
  expect(panel.style.width).toBe("30rem");
});

test("a width is kept within its limits", () => {
  expect(clampWorkbenchWidth(3)).toBe(WORKBENCH_MIN);
  expect(clampWorkbenchWidth(500)).toBe(WORKBENCH_MAX);
  expect(clampWorkbenchWidth(24.4)).toBe(24);
});

test("the floating panel hides the handle until it sits beside the chat", () => {
  render(<Workbench tabs={tabs} onClose={() => {}} />);
  expect(screen.getByRole("separator").className).toContain("max-wide:hidden");
});

test("Escape and the close button call onClose", async () => {
  const onClose = vi.fn();
  render(<Workbench tabs={tabs} onClose={onClose} />);
  await userEvent.click(screen.getByRole("button", { name: "Hide details" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  screen.getByRole("tab", { name: "Changes" }).focus();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("openWorkbench opens a closed panel on that tab", () => {
  drawerOpenStore.set(false);
  act(() => openWorkbench("todos"));
  expect(drawerOpenStore.getSnapshot()).toBe(true);
  expect(tabStore.getSnapshot()).toBe("todos");
});

test("openChange opens the Changes tab and remembers the path until it is cleared", () => {
  const { result } = renderHook(() => useRequestedChange());
  act(() => openChange("src/a.py"));
  expect(result.current[0]).toBe("src/a.py");
  expect(tabStore.getSnapshot()).toBe("changes");
  act(() => result.current[1]());
  expect(result.current[0]).toBeNull();
});

test("openChange with no changes tab shows the first tab", () => {
  act(() => openChange("x"));
  render(<Workbench tabs={tabs.slice(0, 1)} onClose={() => {}} />);
  expect(screen.getByText("todo content")).toBeTruthy();
});
