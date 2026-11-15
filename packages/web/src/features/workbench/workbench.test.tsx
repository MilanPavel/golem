import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { Workbench, type WorkbenchTab } from "./workbench.tsx";
import { TAB_KEY, WIDE_KEY, openChange, openWorkbench, tabStore, useRequestedChange, wideStore } from "./workbench-state.ts";

const tabs: WorkbenchTab[] = [
  { id: "todos", label: "Todos", badge: "2/5", render: () => <p>todo content</p> },
  { id: "changes", label: "Changes", render: () => <p>changes content</p> },
];

beforeEach(() => {
  localStorage.clear();
  tabStore.set(null);
  wideStore.set(false);
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

test("the wide toggle sets the width class and is remembered", async () => {
  render(<Workbench tabs={tabs} onClose={() => {}} />);
  const panel = screen.getByRole("complementary", { name: "Details" });
  expect(panel.className).toContain("w-80");
  const toggle = screen.getByRole("button", { name: "Wide" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  await userEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(panel.className).toContain("w-workbench-wide");
  expect(panel.className).not.toContain("w-80");
  expect(localStorage.getItem(WIDE_KEY)).toBe("wide");
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
