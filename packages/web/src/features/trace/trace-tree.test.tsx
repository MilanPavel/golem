import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { expect, test } from "vitest";
import { inputSeries, totalTokens } from "./format.ts";
import { FAILED_TRACE, LONG_TRACE, OLD_TRACE, SHORT_TRACE, sampleModel, sampleRun, sampleTool } from "./sample.ts";
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
  expect(run?.textContent).toContain("0m 04.2s");
  expect(model?.textContent).toContain("model 1");
  expect(model?.textContent).toContain("0m 02.1s");
  expect(model?.textContent).toContain("3.2K");
  expect(tool?.textContent).toContain("grep");
  expect(tool?.textContent).toContain("0m 00.048s");
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

test("a model row has a fill bar and its input with the share of the window", () => {
  render(<Tree runs={SHORT_TRACE} />);
  const second = items()[4] as HTMLElement;
  expect(second.textContent).toContain("3.4K · 2%");
  expect(second.querySelector("[data-part=fill]")).not.toBeNull();
  expect(second.querySelector("[title]")?.getAttribute("title")).toBe("3.4K in · 210 out · 2% of 128K");
});

test("a run row has its total and its end context, and a track with ticks", () => {
  render(<Tree runs={SHORT_TRACE} />);
  const run = items()[0] as HTMLElement;
  expect(run.textContent).toContain("6.9K · 2%");
  expect(run.querySelector("[title]")?.getAttribute("title")).toContain("context at the end 3.4K / 128K (2%)");
  expect(run.querySelectorAll("[data-part=tick]")).toHaveLength(1);
  expect(run.querySelector("[data-part=tick-label]")?.textContent).toBe("0m 02s");
  expect(items()[1]?.querySelector("[data-part=tick]")).toBeNull();
});


const HELPER_TRACE: TraceRunSpan[] = [
  sampleRun("r_1", "Look around", 0, 9000, [
    sampleModel(
      "m_1",
      1,
      0,
      1000,
      [
        {
          ...sampleTool("d_1", "delegate", 1000, 6000),
          children: [
            sampleModel("k_1", 1, 1100, 900, [sampleTool("kc_1", "read_file", 2000, 30)], { tokens: [4000, 50], window: 8000 }),
            sampleModel("k_2", 2, 2100, 800, [], { tokens: [4500, 600], window: 8000 }),
          ],
        },
      ],
      { tokens: [2000, 40], window: 32000 },
    ),
    sampleModel("m_2", 2, 7100, 1500, [], { tokens: [2600, 200], window: 32000 }),
  ]),
];

test("a helper's calls draw as two more levels under the delegate tool", () => {
  render(<Tree runs={HELPER_TRACE} />);
  expect(items().map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "3", "4", "5", "4", "2"]);
  expect(names().map((name) => name.slice(0, 12))).toEqual([
    expect.stringContaining("Run"),
    expect.stringContaining("model 1"),
    expect.stringContaining("delegate"),
    expect.stringContaining("model 1"),
    expect.stringContaining("read_file"),
    expect.stringContaining("model 2"),
    expect.stringContaining("model 2"),
  ]);
  // A helper's call has its own context meter against its own window.
  const helperCall = items()[3] as HTMLElement;
  expect(helperCall.textContent).toContain("4.0K · 50%");
  expect(items()[2]?.getAttribute("aria-expanded")).toBe("true");
});

test("a helper's rows fold with the delegate row and a helper's model call is selectable", async () => {
  const user = userEvent.setup();
  render(<Tree runs={HELPER_TRACE} />);
  await user.click(within(items()[2] as HTMLElement).getByText("▾"));
  expect(items().map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "3", "2"]);
  await user.click(within(items()[2] as HTMLElement).getByText("▸"));
  await user.click(items()[3] as HTMLElement);
  expect(items()[3]?.getAttribute("aria-selected")).toBe("true");
});

test("a run holding a helper's span is open, and the run's totals count the helper", () => {
  render(<Tree runs={[...SHORT_TRACE, ...HELPER_TRACE]} start="kc_1" />);
  expect(screen.getByRole("treeitem", { name: /read_file/, selected: true })).toBeTruthy();
  // 2.0K + 40 + 4.0K + 50 + 4.5K + 600 + 2.6K + 200 = 14.0K
  expect(items().find((item) => item.getAttribute("aria-level") === "1" && item.textContent?.includes("Look around"))?.textContent).toContain("14.0K");
});

test("the context series leaves the helper out, and the token total counts it", () => {
  expect(inputSeries(HELPER_TRACE)).toEqual([2000, 2600]);
  expect(totalTokens(HELPER_TRACE)).toBe(2040 + 4050 + 5100 + 2800);
});
