import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test } from "vitest";
import { RESULT_ROW_CAP, ResultView } from "./result-view.tsx";
import { SAMPLE_RESULTS } from "./workflow-sample.ts";

const sample = (kind: string): unknown => SAMPLE_RESULTS.find(([name]) => name === kind)![1];
const show = (result: unknown) => render(<ResultView result={result} label="Output of step" />);
const out = () => within(screen.getByRole("group", { name: "Output of step" }));

test("text is drawn as Markdown", () => {
  show(sample("text"));
  expect(out().getByRole("heading", { name: "Morning briefing" })).toBeTruthy();
  expect(out().getAllByRole("listitem")).toHaveLength(2);
});

test("a record is labels and values", () => {
  show(sample("record"));
  expect(out().getByText("branch").nextElementSibling?.textContent).toBe("main");
  expect(out().getByText("not_pushed").nextElementSibling?.textContent).toBe("2");
});

test("a table has headers and rows", () => {
  show(sample("table"));
  expect(out().getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["message", "level", "times"]);
  expect(out().getAllByRole("row")).toHaveLength(4);
  expect(out().getByRole("cell", { name: "GitHub Copilot MCP unreachable" })).toBeTruthy();
});

test("a long table stops at the cap and says how many more", () => {
  show(Array.from({ length: RESULT_ROW_CAP + 8 }, (_, i) => ({ n: i })));
  expect(out().getAllByRole("row")).toHaveLength(RESULT_ROW_CAP + 1);
  expect(out().getByText("8 more")).toBeTruthy();
});

test("a file is a card with its path", () => {
  show(sample("file"));
  expect(out().getByText("~/.golem/briefings/2026-11-27.md")).toBeTruthy();
  expect(out().getByText("File")).toBeTruthy();
});

test("a link is a link", () => {
  show(sample("link"));
  expect(out().getByRole("link").getAttribute("href")).toBe("https://github.com/golem/golem/pull/1921");
});

test("a worker's result is its changes", () => {
  show(sample("changes"));
  expect(out().getByText("wf-typer-1")).toBeTruthy();
  expect(out().getByText("1 file, +6 −2")).toBeTruthy();
});

test("an empty list says Nothing found, not []", () => {
  show(sample("empty"));
  expect(out().getByText("Nothing found")).toBeTruthy();
  expect(screen.queryByText("[]")).toBeNull();
});

test("anything else is indented JSON", () => {
  show(sample("other"));
  expect(screen.getByRole("group", { name: "Output of step" }).querySelector("pre")?.textContent).toBe("[\n  1,\n  2,\n  3\n]");
});

test("Raw shows the JSON, and Readable brings the view back", async () => {
  const user = userEvent.setup();
  show(sample("record"));
  await user.click(screen.getByRole("button", { name: "Raw" }));
  expect(screen.getByRole("button", { name: "Raw" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("group", { name: "Output of step" }).querySelector("pre")?.textContent).toBe(JSON.stringify(sample("record"), null, 2));
  await user.click(screen.getByRole("button", { name: "Readable" }));
  expect(out().getByText("branch")).toBeTruthy();
});

test("no result draws nothing", () => {
  const { container } = show(null);
  expect(container.textContent).toBe("");
});

test("each kind has no accessibility violations", async () => {
  for (const [, result] of SAMPLE_RESULTS) {
    const { container, unmount } = show(result);
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
    unmount();
  }
});
