import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DiffModeSwitch } from "./diff-mode-switch.tsx";
import { DIFF_MODE_KEY, diffModeStore, readDiffMode, useDiffMode } from "./diff-mode.ts";
import { DiffView } from "./diff-view.tsx";
import { SAMPLE_EDIT_DIFF, SAMPLE_NEW_FILE_DIFF } from "./sample.ts";

beforeEach(() => {
  diffModeStore.set("unified");
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("the unified view shows both line numbers and the sign in its own cell", () => {
  render(<DiffView diff={SAMPLE_EDIT_DIFF} mode="unified" />);
  expect(screen.getByRole("table", { name: "Change to src/socket.ts" })).toBeTruthy();
  const cell = screen.getByText('import { clamp } from "./clamp";');
  const row = cell.closest("tr");
  expect(row?.dataset.row).toBe("add");
  const cells = within(row as HTMLElement).getAllByRole("cell");
  expect(cells.map((c) => c.textContent)).toEqual(["", "2", "+", 'import { clamp } from "./clamp";']);
  const context = screen.getByText('import { WebSocket } from "ws";').closest("tr") as HTMLElement;
  expect(within(context).getAllByRole("cell").map((c) => c.textContent).slice(0, 2)).toEqual(["1", "1"]);
  expect(screen.getByText("@@ -1,6 +1,7 @@").closest("td")?.className).toContain("bg-sunken");
});

test("the path shows, with a note for a new file", () => {
  render(<DiffView diff={SAMPLE_NEW_FILE_DIFF} mode="unified" />);
  expect(screen.getByText("src/clamp.ts")).toBeTruthy();
  expect(screen.getByText("new file")).toBeTruthy();
});

test("the split view puts the old line on the left and the new one on the right", () => {
  render(<DiffView diff={"@@ -1 +1 @@\n-old\n+new\n"} mode="split" />);
  const row = screen.getByText("old").closest("tr") as HTMLElement;
  expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1", "-", "old", "1", "+", "new"]);
});

test("hostile text is text, not markup", () => {
  const { container } = render(<DiffView diff={"@@ -1 +1 @@\n-<img src=x onerror=alert(1)>\n+<img src=y onerror=alert(2)>\n"} mode="unified" />);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
});

function Harness() {
  const [mode, setMode] = useDiffMode();
  return <DiffModeSwitch mode={mode} onChange={setMode} />;
}

test("the switch flips the mode and keeps the choice", () => {
  render(<Harness />);
  const unified = screen.getByRole("button", { name: "Unified" });
  const split = screen.getByRole("button", { name: "Split" });
  expect(unified.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(split);
  expect(split.getAttribute("aria-pressed")).toBe("true");
  expect(unified.getAttribute("aria-pressed")).toBe("false");
  expect(localStorage.getItem(DIFF_MODE_KEY)).toBe("split");
  expect(readDiffMode()).toBe("split");
});

test("a storage that throws leaves the switch working, on unified", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readDiffMode()).toBe("unified");
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Split" }));
  expect(screen.getByRole("button", { name: "Split" }).getAttribute("aria-pressed")).toBe("true");
});
