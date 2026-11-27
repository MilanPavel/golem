import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

test("the gallery shows a step result of each kind", () => {
  showTheme("slip");
  render(<Gallery />);
  const results = within(screen.getByRole("region", { name: "Step results by kind, slip" }));
  for (const kind of ["text", "record", "table", "file", "link", "changes", "empty", "other"]) expect(results.getByRole("group", { name: `Result, ${kind}` })).toBeTruthy();
  expect(results.getByText("Nothing found")).toBeTruthy();
});

test("the gallery's Runs section shows the panel, the grouped list, and the banner for each trigger", () => {
  showTheme("slip");
  render(<Gallery />);
  const panel = within(screen.getByRole("complementary", { name: "Runs, slip" }));
  expect(panel.getByRole("list", { name: "Needs you" })).toBeTruthy();
  expect(within(screen.getByRole("complementary", { name: "Runs, empty, slip" })).getByText("Nothing has run yet.")).toBeTruthy();
  const list = within(screen.getByRole("region", { name: "Runs list, slip" }));
  expect(list.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Needs you (1)", "Running (1)", "Today (2)", "Earlier (3)"]);
  const banners = within(screen.getByRole("region", { name: "Routine banners, slip" }));
  const text = banners.getAllByRole("region", { name: /^Routine run, / }).map((banner) => banner.textContent ?? "");
  expect(text).toHaveLength(3);
  expect(text[0]).toContain("by schedule");
  expect(text[0]).toContain("1 approval waiting");
  expect(text[1]).toContain("by you");
  expect(text[2]).toContain("by new file receipt-0412.pdf");
});

test("the gallery's Runs page shows the filter chip with its result beside the list, a failed run open, and an empty filter", () => {
  showTheme("slip");
  render(<Gallery />);
  const filtered = within(screen.getByRole("region", { name: "Runs page, filtered to a workflow, slip" }));
  expect(filtered.getByText("Workflow: pr_digest")).toBeTruthy();
  expect(filtered.getByText("3 things need you")).toBeTruthy();
  expect(filtered.queryByText("sentry-triage")).toBeNull();
  // A run of a workflow of the same name in another folder is left out: the filter matches by id.
  expect(filtered.queryByText("Digest of the web project")).toBeNull();
  expect(within(screen.getByRole("region", { name: "Runs page, a failed run open, slip" })).getByRole("group", { name: "Why it stopped" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Runs page, nothing for the filter, slip" })).getByText("pr_digest has not run yet.")).toBeTruthy();
  const every = within(screen.getByRole("region", { name: "Runs page, every run, slip" }));
  expect(every.queryByText("Workflow: pr_digest")).toBeNull();
  expect(every.getAllByText("Digest of the web project").length).toBeGreaterThan(0);
  expect(every.getAllByText("sentry-triage").length).toBeGreaterThan(0);
});

test("the gallery shows a run that goes with a known total, with none, a loop part way and a parallel group", () => {
  showTheme("slip");
  render(<Gallery />);
  const known = within(screen.getByRole("region", { name: "Workflow run, running, slip" }));
  expect(known.getByText("2 of 5 steps")).toBeTruthy();
  expect(known.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("5");
  const unknown = within(screen.getByRole("region", { name: "Workflow run, running, no total to count against, slip" }));
  expect(unknown.getByText("3 steps so far")).toBeTruthy();
  expect(unknown.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
  const loop = within(screen.getByRole("region", { name: "Workflow run, running, a loop twelve feeds in, slip" }));
  expect(loop.getByRole("button", { name: /^Reading feed, 12 of 30/ })).toBeTruthy();
  expect(loop.getByText(/Reading feed 13 of 30 · feed-13\.example\.com\/rss/)).toBeTruthy();
  const group = within(screen.getByRole("region", { name: "Workflow run, running, a parallel group, slip" }));
  expect(within(group.getByRole("list", { name: "Working now" })).getAllByRole("listitem")).toHaveLength(3);
  const writing = within(screen.getByRole("region", { name: "Workflow run, running, a model answer as it is written, slip" }));
  expect(within(writing.getByRole("group", { name: "Live" })).getByText("2 projects changed")).toBeTruthy();
  expect(writing.getByRole("group", { name: "Writing the briefing, as it comes" }).textContent).toContain("3 pull requests wait on you");
  expect(writing.getByText(/usually about 45s/)).toBeTruthy();
});
