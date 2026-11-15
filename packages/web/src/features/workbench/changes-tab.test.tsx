import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChangedFile } from "../../store/changes.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { diffModeStore } from "../diff/diff-mode.ts";
import { SAMPLE_EDIT_DIFF, SAMPLE_NEW_FILE_DIFF } from "../diff/sample.ts";
import { ChangesTab } from "./changes-tab.tsx";
import { openChange } from "./workbench-state.ts";
import { WORKBENCH_DEFAULT, workbenchWidthStore } from "./workbench-width.ts";

const FILES: ChangedFile[] = [
  { path: "src/socket.ts", status: "modified", added: 18, removed: 4, change_ids: ["c1"], stale: false },
  { path: "src/clamp.ts", status: "created", added: 3, removed: 0, change_ids: ["c2"], stale: true },
  { path: "old.md", status: "deleted", added: 0, removed: 22, change_ids: ["c3"], stale: false },
];

function setup(files: ChangedFile[] = FILES) {
  const fake = fakeClient();
  fake.raw.changesList.mockImplementation(async () => ({ files }));
  fake.raw.changesDiff.mockImplementation(async (_id, target) => ({
    diff: "path" in target && target.path === "src/clamp.ts" ? SAMPLE_NEW_FILE_DIFF : SAMPLE_EDIT_DIFF,
    truncated: false,
  }));
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <ChangesTab sessionId="a" />
    </PageProvider>,
  );
  return { fake, page };
}

beforeEach(() => {
  localStorage.clear();
  diffModeStore.set("unified");
  workbenchWidthStore.set(WORKBENCH_DEFAULT);
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("it lists the files with their counts, a badge, and the totals, the first one open", async () => {
  const { fake, page } = setup();
  const rows = await screen.findAllByRole("listitem");
  expect(rows).toHaveLength(3);
  expect(head(rows[0]!).textContent).toContain("socket.ts");
  expect(within(rows[0]!).getByText(/^\+18/)).toBeTruthy();
  expect(within(rows[0]!).getByText(/^−4/)).toBeTruthy();
  expect(within(rows[1]!).getByText("new")).toBeTruthy();
  expect(within(rows[1]!).getByText("changed on disk")).toBeTruthy();
  expect(within(rows[2]!).getByText("deleted")).toBeTruthy();
  expect(within(rows[0]!).queryByText("changed on disk")).toBeNull();
  expect(screen.getByText("3 files").parentElement?.textContent).toContain("+21");
  expect(screen.getByText("3 files").parentElement?.textContent).toContain("−26");
  await screen.findByRole("table", { name: "Change to src/socket.ts" });
  expect(fake.raw.changesDiff).toHaveBeenCalledWith("a", { path: "src/socket.ts" });
  page.stop();
});

test("a click opens another file, one at a time, and a second click closes it", async () => {
  const { fake, page } = setup();
  await screen.findByRole("table");
  const rows = screen.getAllByRole("listitem");
  await userEvent.click(head(rows[1]!));
  expect(fake.raw.changesDiff).toHaveBeenCalledWith("a", { path: "src/clamp.ts" });
  await screen.findByRole("table", { name: "Change to src/clamp.ts" });
  expect(screen.getAllByRole("table")).toHaveLength(1);
  await userEvent.click(head(rows[1]!));
  expect(screen.queryByRole("table")).toBeNull();
  page.stop();
});

test("a file.changed event reads the list again once for a burst", async () => {
  const { fake, page } = setup();
  await screen.findByRole("table");
  expect(fake.raw.changesList).toHaveBeenCalledTimes(1);
  fake.raw.changesList.mockImplementation(async () => ({ files: [...FILES, { path: "new.ts", status: "created", added: 1, removed: 0, change_ids: ["c4"], stale: false }] }));
  act(() => {
    fake.emitEvent(ev("a", "file.changed", { path: "new.ts" }));
    fake.emitEvent(ev("a", "file.changed", { path: "new.ts" }));
  });
  await screen.findByText("4 files");
  expect(fake.raw.changesList).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(fake.raw.changesDiff).toHaveBeenCalledTimes(2));
  page.stop();
});

test("an event for another session does nothing", async () => {
  const { fake, page } = setup();
  await screen.findByRole("table");
  act(() => fake.emitEvent(ev("b", "file.changed", { path: "x" })));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 250)));
  expect(fake.raw.changesList).toHaveBeenCalledTimes(1);
  page.stop();
});

test("with no changes it says so", async () => {
  const { page } = setup([]);
  expect(await screen.findByText("No changes yet. Files golem edits in this session show up here.")).toBeTruthy();
  page.stop();
});

test("a cut diff says so under the table", async () => {
  const fake = fakeClient();
  fake.raw.changesList.mockImplementation(async () => ({ files: FILES }));
  fake.raw.changesDiff.mockImplementation(async () => ({ diff: SAMPLE_EDIT_DIFF, truncated: true }));
  const page = createPage(fake.client, { frame: fakeFrame(), doc: Object.assign(new EventTarget(), { visibilityState: "visible" }) as unknown as Document });
  page.start();
  render(
    <PageProvider page={page}>
      <ChangesTab sessionId="a" />
    </PageProvider>,
  );
  expect(await screen.findByText("This diff is cut. Open the file to see all of it.")).toBeTruthy();
  page.stop();
});

test("openChange opens that file's row and clears the request", async () => {
  const { fake, page } = setup();
  await screen.findByRole("table", { name: "Change to src/socket.ts" });
  act(() => openChange("old.md"));
  await waitFor(() => expect(fake.raw.changesDiff).toHaveBeenCalledWith("a", { path: "old.md" }));
  const rows = screen.getAllByRole("listitem");
  expect(head(rows[2]!).getAttribute("aria-expanded")).toBe("true");
  expect(head(rows[0]!).getAttribute("aria-expanded")).toBe("false");
  page.stop();
});

test("the layout switch is off under 40 rem and on from 40", async () => {
  const { page } = setup();
  await screen.findByRole("table");
  expect((screen.getByRole("button", { name: "Split" }) as HTMLButtonElement).disabled).toBe(true);
  act(() => workbenchWidthStore.set(40));
  const split = screen.getByRole("button", { name: "Split" }) as HTMLButtonElement;
  expect(split.disabled).toBe(false);
  diffModeStore.set("split");
  await waitFor(() => expect(document.querySelector("[data-diff-mode='split']")).toBeTruthy());
  page.stop();
});

/** The button that opens a row. */
function head(row: HTMLElement): HTMLElement {
  return row.querySelector("button[aria-expanded]") as HTMLElement;
}
