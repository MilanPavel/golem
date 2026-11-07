import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { PullEntry } from "../../store/pulls.ts";
import { pullSummary } from "./model-text.ts";
import { PullStatusView } from "./pull-status.tsx";

const GB = 1_000_000_000;

function entry(completed: number, total: number | null, speed: number | null = null): PullEntry {
  const samples = speed === null ? [] : [{ at: 0, bytes: completed - speed * 2 }, { at: 2_000, bytes: completed }];
  return { status: "pulling", progress: null, track: { completed, total, samples } };
}

const LABELS = new Map([
  ["ollama/qwen3:8b", "Qwen3 8B"],
  ["ollama/gemma3:12b", "Gemma3 12B"],
]);
const NONE = new Map<string, never>();

// pullSummary

test("pullSummary: nothing to show is null", () => {
  expect(pullSummary(new Map(), new Map(), LABELS)).toBeNull();
});

test("pullSummary: one download has its label, share, and time left", () => {
  const summary = pullSummary(new Map([["ollama/qwen3:8b", entry(1 * GB, 8 * GB, 1_666_667)]]), new Map(), LABELS);
  expect(summary).toMatchObject({ kind: "one", title: "Qwen3 8B", share: 0.125, text: "12% · 1 h 10 min" });
  expect(summary?.spoken).toBe("Downloading Qwen3 8B, 12 percent, 1 hour 10 minutes left");
});

test("pullSummary: with no speed yet the text is the percent only, and a ref without a label is shown as it is", () => {
  const summary = pullSummary(new Map([["ollama/other:1b", entry(GB, 4 * GB)]]), new Map(), LABELS);
  expect(summary).toMatchObject({ kind: "one", title: "ollama/other:1b", text: "25%" });
  expect(summary?.spoken).toBe("Downloading ollama/other:1b, 25 percent");
});

test("pullSummary: a download that has not started says so", () => {
  const summary = pullSummary(new Map([["ollama/qwen3:8b", entry(0, null)]]), new Map(), LABELS);
  expect(summary).toMatchObject({ kind: "one", share: null, text: "starting…" });
});

test("pullSummary: several downloads add up the known sizes and take the longest time", () => {
  const active = new Map([
    ["ollama/qwen3:8b", entry(2 * GB, 4 * GB, 0.05 * GB)],
    ["ollama/gemma3:12b", entry(1 * GB, 4 * GB, 0.01 * GB)],
    ["ollama/mystery:1b", entry(5 * GB, null)],
    ["ollama/empty:1b", entry(0, 0)],
  ]);
  const summary = pullSummary(active, new Map(), LABELS);
  expect(summary).toMatchObject({ kind: "many", title: "4 downloads", share: 3 / 8 });
  expect(summary?.text).toBe("37% · 5 min");
  expect(summary?.spoken).toBe("Downloading 4 downloads, 37 percent, 5 minutes left");
});

test("pullSummary: several downloads of unknown size have no share", () => {
  const summary = pullSummary(new Map([["a", entry(GB, null)], ["b", entry(0, 0)]]), new Map(), LABELS);
  expect(summary).toMatchObject({ kind: "many", share: null, text: "starting…" });
});

test("pullSummary: a failure shows when nothing runs, and a stop is not one", () => {
  const failed = new Map([["ollama/qwen3:8b", "no space left on device"]]);
  expect(pullSummary(new Map(), failed, LABELS)).toMatchObject({
    kind: "failed",
    title: "Download of Qwen3 8B failed",
    ref: "ollama/qwen3:8b",
    text: "no space left on device",
  });
  expect(pullSummary(new Map(), new Map([["ollama/qwen3:8b", "cancelled"]]), LABELS)).toBeNull();
  expect(pullSummary(new Map([["ollama/gemma3:12b", entry(GB, 4 * GB)]]), failed, LABELS)?.kind).toBe("one");
});

// PullStatusView

const ONE = pullSummary(new Map([["ollama/qwen3:8b", entry(GB, 8 * GB, 1_666_667)]]), NONE, LABELS);
const FAILED = pullSummary(new Map(), new Map([["ollama/qwen3:8b", "no space"]]), LABELS);

test("a download shows its title, bar, and text, and a press opens the models", async () => {
  const onOpen = vi.fn();
  render(<PullStatusView summary={ONE} announcement="" onOpen={onOpen} onDismiss={() => {}} />);
  const row = screen.getByRole("button", { name: "Downloading Qwen3 8B, 12 percent, 1 hour 10 minutes left. Open models" });
  expect(row.textContent).toContain("Qwen3 8B");
  expect(row.textContent).toContain("12% · 1 h 10 min");
  await userEvent.click(row);
  expect(onOpen).toHaveBeenCalledWith(row);
});

test("many downloads show their count", () => {
  const many = pullSummary(new Map([["a", entry(GB, 4 * GB)], ["b", entry(GB, 4 * GB)]]), NONE, LABELS);
  render(<PullStatusView summary={many} announcement="" onOpen={() => {}} onDismiss={() => {}} />);
  expect(screen.getByRole("button", { name: /^Downloading 2 downloads, 25 percent/ }).textContent).toContain("2 downloads");
});

test("a failure is in the wait tone, opens the models, and its × dismisses it", async () => {
  const onOpen = vi.fn();
  const onDismiss = vi.fn();
  const { container } = render(<PullStatusView summary={FAILED} announcement="" onOpen={onOpen} onDismiss={onDismiss} />);
  expect(container.querySelector(".text-wait")).not.toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Download of Qwen3 8B failed: no space. Open models" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Dismiss: Download of Qwen3 8B failed" }));
  expect(onDismiss).toHaveBeenCalledWith("ollama/qwen3:8b");
});

test("nothing to show leaves only an empty live region", () => {
  render(<PullStatusView summary={null} announcement="" onOpen={() => {}} onDismiss={() => {}} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(document.querySelector("[aria-live=polite]")?.textContent).toBe("");
});

test("the live region says the announcement, not the percent", () => {
  const { rerender } = render(<PullStatusView summary={ONE} announcement="Downloading Qwen3 8B" onOpen={() => {}} onDismiss={() => {}} />);
  expect(document.querySelector("[aria-live=polite]")?.textContent).toBe("Downloading Qwen3 8B");
  const more = pullSummary(new Map([["ollama/qwen3:8b", entry(2 * GB, 8 * GB, 1_666_667)]]), NONE, LABELS);
  rerender(<PullStatusView summary={more} announcement="Downloading Qwen3 8B" onOpen={() => {}} onDismiss={() => {}} />);
  expect(document.querySelector("[aria-live=polite]")?.textContent).toBe("Downloading Qwen3 8B");
});
