import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { expect, test } from "vitest";
import { FAILED_TRACE, LONG_TRACE, OLD_TRACE, SHORT_TRACE } from "./sample.ts";
import { TraceTree } from "./trace-tree.tsx";
import type { TraceRunSpan } from "../../store/trace.ts";

function Tree({ runs, start = null }: { runs: TraceRunSpan[]; start?: string | null }) {
  const [selected, setSelected] = useState<string | null>(start);
  return <TraceTree runs={runs} selected={selected} onSelect={setSelected} />;
}

const items = () => screen.getAllByRole("treeitem");
const names = () => items().map((item) => item.textContent ?? "");

test("a row for each run, model call, and tool, indented by depth", () => {
  render(<Tree runs={SHORT_TRACE} />);
  expect(items().map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "3", "3", "2"]);
  const [run, model, tool] = items();
  expect(run?.textContent).toContain("Run · What is in notes.txt?");
  expect(run?.textContent).toContain("4.2s");
  expect(model?.textContent).toContain("model 1");
  expect(model?.textContent).toContain("2.1s");
  expect(model?.textContent).toContain("3.3K");
  expect(tool?.textContent).toContain("grep");
  expect(tool?.textContent).toContain("48ms");
  expect(within(tool as HTMLElement).getByText("ok")).toBeTruthy();
  expect(model?.getAttribute("aria-expanded")).toBe("true");
  expect(tool?.getAttribute("aria-expanded")).toBeNull();
});

test("only the last run is open", () => {
  render(<Tree runs={LONG_TRACE} />);
  const [first, ...rest] = items();
  expect(first?.getAttribute("aria-expanded")).toBe("false");
  expect(first?.textContent).toContain("Read every file");
  // The folded run hides its 25 calls; the last run shows its one.
  expect(rest.map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2"]);
});

test("a run holding the selected span is open too", () => {
  render(<Tree runs={LONG_TRACE} start="c_3" />);
  expect(items().length).toBe(1 + 25 + 25 + 1 + 1);
  expect(screen.getByRole("treeitem", { name: /read_file/, selected: true })).toBeTruthy();
});

test("a click selects, and the arrow folds", async () => {
  const user = userEvent.setup();
  render(<Tree runs={SHORT_TRACE} />);
  await user.click(items()[1] as HTMLElement);
  expect(items()[1]?.getAttribute("aria-selected")).toBe("true");
  expect(items().length).toBe(5);
  await user.click(within(items()[0] as HTMLElement).getByText("▾"));
  expect(items().length).toBe(1);
});

test("the tree is one tab stop", () => {
  render(<Tree runs={SHORT_TRACE} />);
  expect(items().filter((item) => item.tabIndex === 0)).toHaveLength(1);
  expect(items()[0]?.tabIndex).toBe(0);
});

test("arrows move, right opens or goes to the first child, left closes or goes to the parent", async () => {
  const user = userEvent.setup();
  render(<Tree runs={SHORT_TRACE} />);
  items()[0]?.focus();
  await user.keyboard("{ArrowDown}");
  expect(document.activeElement?.textContent).toContain("model 1");
  expect(items()[1]?.getAttribute("aria-selected")).toBe("true");
  await user.keyboard("{ArrowRight}"); // open already: first child
  expect(document.activeElement?.textContent).toContain("grep");
  await user.keyboard("{ArrowLeft}"); // a tool has no children: its parent
  expect(document.activeElement?.textContent).toContain("model 1");
  await user.keyboard("{ArrowLeft}"); // open: close
  expect(items().map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "2"]);
  expect(items()[1]?.getAttribute("aria-expanded")).toBe("false");
  await user.keyboard("{ArrowRight}"); // closed: open
  expect(items()).toHaveLength(5);
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement?.textContent).toContain("Run ·");
  await user.keyboard("{ArrowUp}");
  expect(document.activeElement?.textContent).toContain("Run ·");
});

test("Enter opens and closes a row", async () => {
  const user = userEvent.setup();
  render(<Tree runs={SHORT_TRACE} />);
  items()[0]?.focus();
  await user.keyboard("{Enter}");
  expect(items()).toHaveLength(1);
  await user.keyboard("{Enter}");
  expect(items()).toHaveLength(5);
});

test("a failed tool ends with a cross, and a denied one says denied", () => {
  render(<Tree runs={FAILED_TRACE} />);
  const [, , shell, write] = items();
  expect(within(shell as HTMLElement).getByText("failed")).toBeTruthy();
  expect(shell?.textContent).toContain("✗");
  expect(write?.textContent).toContain("denied");
});

test("a model call from before traces says not recorded, with a dash for tokens", async () => {
  const user = userEvent.setup();
  render(<Tree runs={OLD_TRACE} />);
  const model = items()[1] as HTMLElement;
  expect(model.textContent).toContain("not recorded");
  expect(model.textContent).toContain("—");
  await user.hover(within(model).getByText("not recorded"));
  expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", expect.stringContaining("ran before golem kept traces"));
});

test("the tree has no accessibility violations", async () => {
  const { container } = render(<Tree runs={FAILED_TRACE} />);
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(results.violations).toEqual([]);
  expect(names().length).toBeGreaterThan(0);
});
