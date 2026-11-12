import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

// The dialog tests are in gallery-tune, gallery-setup and gallery-palette, so vitest runs them in parallel.
resetThemeAfterEach();

// The one test that walks the whole gallery in both themes: about 6 s locally, over 20 s on a shared CI runner.
test("the gallery shows both themes and has no accessibility violations", { timeout: 60_000 }, async () => {
  const { container } = render(<Gallery />);
  expect(container.querySelector('[data-theme="slip"]')).toBeTruthy();
  expect(container.querySelector('[data-theme="kiln"]')).toBeTruthy();
  // Each trace demo repeats the same "Context window" landmark, so unique landmark names are not checked here.
  await expectAxeClean(container, { "landmark-unique": { enabled: false } });
});

test("the gallery's model dialog shows a download with its speed and time left, and passes axe", async () => {
  showTheme("slip");
  const user = userEvent.setup();
  render(<Gallery />);
  await user.click(screen.getByRole("button", { name: "Download in progress, slip" }));
  const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  expect(dialog.textContent).toContain("2.1 / 6.6 GB · 12 MB/s · 6 min");
  expect(dialog.textContent).toContain("Download failed: no space left on device");
  await expectAxeClean(dialog, DIALOG_RULES);
});

test("the gallery's Commands dialog lists the groups and passes axe", async () => {
  showTheme("kiln");
  const user = userEvent.setup();
  render(<Gallery />);
  await user.click(screen.getByRole("button", { name: "Commands, kiln" }));
  const dialog = await screen.findByRole("dialog", { name: "Commands" });
  expect(dialog.textContent).toContain("In the terminal for now");
  await expectAxeClean(dialog, DIALOG_RULES);
});

test("each gallery section has a stable anchor, the slip one plain and the kiln one prefixed, and no id repeats", () => {
  const { container } = render(<Gallery />);
  for (const id of ["trace", "approval", "setup-form", "model-dialog", "kiln-trace", "kiln-approval"]) {
    expect(container.querySelector(`#${id}`), id).toBeTruthy();
  }
  const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the gallery shows one theme when asked, and then the anchors have no prefix", async () => {
  const user = userEvent.setup();
  const { container } = render(<Gallery />);
  await user.click(screen.getByRole("button", { name: "Kiln" }));
  expect(container.querySelector('[data-theme="slip"]')).toBeNull();
  expect(container.querySelector("#trace")).toBeTruthy();
  expect(container.querySelector("#kiln-trace")).toBeNull();
});

test("the gallery has a Thinking section with streaming, done, none, and long cases", () => {
  showTheme("slip");
  render(<Gallery />);
  for (const label of ["streaming", "done", "no thinking", "hidden", "long thinking"]) {
    expect(screen.getAllByRole("group", { name: `Thinking, ${label}` }).length).toBeGreaterThan(0);
  }
  expect(screen.getAllByRole("button", { name: /thought for 12s/ }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /thinking…/ }).length).toBeGreaterThan(0);
  for (const group of screen.getAllByRole("group", { name: "Thinking, hidden" })) {
    expect(group.querySelector("[data-thinking]")).toBeNull();
    expect(group.textContent).toContain("17 * 23 = 391.");
  }
});

for (const theme of ["slip", "kiln"] as const) {
  test(`the gallery's turn with four tool steps folds into one activity line in ${theme}, and passes axe`, async () => {
    showTheme(theme);
    render(<Gallery />);
    const normal = screen.getByRole("group", { name: "A turn with four tool steps, normal" });
    expect(normal.querySelectorAll("svg[data-state]")).toHaveLength(1);
    expect(within(normal).getAllByText("8.8s · 4 steps")).toHaveLength(1);
    const line = within(normal).getByRole("button", { name: /github calls, 1 failed/ });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(within(normal).queryByRole("list", { name: "Tool calls" })).toBeNull();
    const verbose = screen.getByRole("group", { name: "A turn with four tool steps, verbose" });
    expect(within(verbose).getByRole("list", { name: "Tool calls" })).toBeTruthy();
    expect(within(verbose).getAllByText("github · get_me").length).toBeGreaterThan(0);
    const quiet = screen.getByRole("group", { name: "A turn with four tool steps, quiet" });
    expect(within(quiet).getByRole("button", { name: "4 steps" })).toBeTruthy();
    for (const group of [normal, verbose, quiet]) await expectAxeClean(group, DIALOG_RULES);
  });
}
