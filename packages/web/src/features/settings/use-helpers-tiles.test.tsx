import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { SAMPLE_DELEGATE, SAMPLE_DELEGATE_CHANGED } from "./agents-sample.ts";
import { agentsTabStore, showAgentsTab } from "./agents-tab.ts";
import { UseHelpers } from "./use-helpers-setting.tsx";

afterEach(() => showAgentsTab("agents"));

const tile = (key: string) => document.querySelector(`[data-reason="${key}"]`) as HTMLElement;

test("the three tiles show the default numbers and say what golem suggests", () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />);
  expect(within(tile("fit")).getByText("It would not fit")).toBeTruthy();
  expect(tile("fit").textContent).toContain("golem suggests a helper when the reading is over 30% of the window, or the window is already 85% full.");
  expect(tile("parallel").textContent).toContain("each at least 10% of the window.");
  expect(tile("model").textContent).toContain("a model 3× cheaper");
  expect(document.querySelectorAll("[data-changed]").length).toBe(0);
  expect(screen.getByText("FIRST GUESS")).toBeTruthy();
});

test("changed numbers show, are marked, and the foot says so", () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} onChoose={() => {}} />);
  expect(tile("fit").textContent).toContain("over 42% of the window, or the window is already 80% full");
  expect(Array.from(document.querySelectorAll("[data-changed]")).map((each) => each.textContent)).toEqual(["42%", "80%"]);
  expect(screen.getByText("CHANGED")).toBeTruthy();
});

test("a measurement in use is named in the foot", () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} measurement={{ date: "23 Nov", model: "qwen3.8:27b" }} onChoose={() => {}} />);
  expect(screen.getByText("MEASURED")).toBeTruthy();
  expect(document.querySelector("[data-reasons-foot]")?.textContent).toContain("on 23 Nov with qwen3.8:27b.");
  expect(screen.getByRole("button", { name: "Measure again" })).toBeTruthy();
});

test("Never dims the tiles but keeps them", () => {
  const { rerender } = render(<UseHelpers value="never" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />);
  expect(document.querySelector("[data-reasons]")?.hasAttribute("data-dimmed")).toBe(true);
  expect(tile("fit")).toBeTruthy();
  rerender(<UseHelpers value="ask" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />);
  expect(document.querySelector("[data-reasons]")?.hasAttribute("data-dimmed")).toBe(false);
});

test("no numbers from the daemon, no tiles", () => {
  render(<UseHelpers value="when_needed" onChoose={() => {}} />);
  expect(document.querySelector("[data-reasons]")).toBeNull();
});

test("Measure on this Mac opens the Measure tab", async () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Measure on this Mac" }));
  expect(agentsTabStore.getSnapshot()).toBe("measure");
});

test("the tiles pass axe", async () => {
  const { container } = render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} onChoose={() => {}} />);
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations).toEqual([]);
});
