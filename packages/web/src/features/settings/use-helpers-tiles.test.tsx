import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { SAMPLE_DELEGATE, SAMPLE_DELEGATE_CHANGED } from "./agents-sample.ts";
import { agentsTabStore, showAgentsTab } from "./agents-tab.ts";
import { UseHelpers } from "./use-helpers-setting.tsx";

afterEach(() => showAgentsTab("agents"));

const tile = (key: string) => document.querySelector(`[data-reason="${key}"]`) as HTMLElement;

test("the three blocks show the default numbers as When and Then lines", () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />);
  expect(within(tile("fit")).getByText("Too much to read")).toBeTruthy();
  expect(tile("fit").textContent).toContain("A job needs to read more than 30% of the context window, or the window is already 85% full.");
  expect(tile("fit").textContent).toContain("A helper reads it in its own window and brings back the answer.");
  expect(tile("parallel").textContent).toContain("each needs at least 10% of the window.");
  expect(tile("parallel").textContent).toContain("One helper per job, all at once.");
  expect(tile("model").textContent).toContain("a model at least 3× cheaper");
  expect(tile("model").textContent).toContain("Needs a second model that is ready");
  expect(screen.getByText("The context window is what the model can hold at once. These numbers come from Measure.")).toBeTruthy();
  expect(document.querySelectorAll("[data-changed]").length).toBe(0);
  expect(document.querySelectorAll("[data-default-tag]").length).toBe(0);
  expect(screen.getByText("FIRST GUESS")).toBeTruthy();
});

test("each block has a decorative picture and bars that match its numbers", () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} onChoose={() => {}} />);
  for (const key of ["fit", "parallel", "model"]) {
    const svg = tile(key).querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(tile(key).querySelector("[data-window]")?.getAttribute("aria-hidden")).toBe("true");
  }
  const widths = (key: string) => Array.from(tile(key).querySelectorAll<HTMLElement>("[data-part]")).map((each) => each.style.width);
  expect(widths("fit")).toEqual(["42%", "80%"]);
  expect(widths("parallel")).toEqual(["10%", "10%"]);
  expect(widths("model")[0]).toBe("100%");
  expect(Number.parseFloat(widths("model")[1] ?? "")).toBeCloseTo(100 / 3, 1);
  expect(Array.from(tile("fit").querySelectorAll("[data-window] span")).map((each) => each.textContent)).toEqual(["one read", "window full"]);
});

test("changed numbers show, are marked, and keep the default tag next to the chip", () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} onChoose={() => {}} />);
  expect(tile("fit").textContent).toContain("more than 42% default 30% of the context window, or the window is already 80% default 85% full");
  expect(Array.from(document.querySelectorAll("[data-changed]")).map((each) => each.textContent)).toEqual(["42%", "80%"]);
  const tag = tile("fit").querySelector("[data-default-tag]") as HTMLElement;
  expect(tag.textContent).toBe("default 30%");
  // The chip and its tag sit in one box that does not wrap.
  expect(tag.parentElement?.className).toContain("whitespace-nowrap");
  expect(tag.parentElement?.querySelector("[data-number]")?.textContent).toBe("42%");
  expect(screen.getByText("CHANGED")).toBeTruthy();
});

test("a measurement in use is named in the foot", () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} measurement={{ date: "23 Nov", model: "qwen3.8:27b" }} onChoose={() => {}} />);
  expect(screen.getByText("MEASURED")).toBeTruthy();
  expect(document.querySelector("[data-reasons-foot]")?.textContent).toContain("on 23 Nov with qwen3.8:27b.");
  expect(screen.getByRole("button", { name: "Measure again" })).toBeTruthy();
});

test("Never dims the blocks, keeps them, and says they are not used", () => {
  const { rerender } = render(<UseHelpers value="never" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />);
  expect(document.querySelector("[data-reasons]")?.hasAttribute("data-dimmed")).toBe(true);
  expect(tile("fit")).toBeTruthy();
  expect(screen.getByText("Not used while helpers are off.")).toBeTruthy();
  rerender(<UseHelpers value="ask" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />);
  expect(document.querySelector("[data-reasons]")?.hasAttribute("data-dimmed")).toBe(false);
  expect(screen.queryByText("Not used while helpers are off.")).toBeNull();
});

test("no numbers from the daemon, no blocks", () => {
  render(<UseHelpers value="when_needed" onChoose={() => {}} />);
  expect(document.querySelector("[data-reasons]")).toBeNull();
});

test("Measure on this Mac opens the Measure tab", async () => {
  render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE} onChoose={() => {}} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Measure on this Mac" }));
  expect(agentsTabStore.getSnapshot()).toBe("measure");
});

test("the blocks pass axe", async () => {
  const { container } = render(<UseHelpers value="when_needed" delegate={SAMPLE_DELEGATE_CHANGED} onChoose={() => {}} />);
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations).toEqual([]);
});
