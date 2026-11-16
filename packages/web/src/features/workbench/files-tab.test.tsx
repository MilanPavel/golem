import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChangedFile } from "../../store/changes.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { FilesTab } from "./files-tab.tsx";
import { hiddenFilesStore } from "./hidden-files.ts";
import { openFile } from "./workbench-state.ts";

const CHANGED: ChangedFile[] = [
  { path: "src/socket.ts", status: "modified", added: 1, removed: 0, change_ids: ["c1"], stale: false },
  { path: "old.md", status: "deleted", added: 0, removed: 3, change_ids: ["c2"], stale: false },
];

function setup() {
  const fake = fakeClient();
  fake.raw.changesList.mockImplementation(async () => ({ files: CHANGED }));
  fake.raw.listFiles.mockImplementation(async (_id, query) => ({
    paths: ["src/fetch.py", "src/socket.ts", "README.md"].filter((path) => path.includes(query ?? "")),
    more: false,
  }));
  fake.raw.readFile.mockImplementation(async (_id, path) => ({ path, text: "import os\nx = '<b>hi</b>'\n\nprint(x)\n", truncated: false, lines: 4 }));
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <FilesTab sessionId="a" />
    </PageProvider>,
  );
  return { fake, page };
}

beforeEach(() => {
  localStorage.clear();
  hiddenFilesStore.set(false);
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("with an empty box the changed files come first, then the folder's files", async () => {
  const { fake, page } = setup();
  await screen.findByText("README.md");
  const names = screen.getAllByRole("button").map((button) => button.getAttribute("title"));
  expect(names).toEqual(["src/socket.ts", "src/fetch.py", "README.md"]);
  expect(fake.raw.listFiles).toHaveBeenCalledWith("a", "", 50, false);
  expect(screen.getByText("Changed in this session")).toBeTruthy();
  page.stop();
});

test("hidden files are off at first, and turning the box on asks for them and is kept", async () => {
  const { fake, page } = setup();
  await screen.findByText("README.md");
  const box = screen.getByRole("checkbox", { name: "Show hidden files" });
  expect((box as HTMLInputElement).checked).toBe(false);
  expect(fake.raw.listFiles).not.toHaveBeenCalledWith("a", "", 50, true);
  await userEvent.click(box);
  await waitFor(() => expect(fake.raw.listFiles).toHaveBeenCalledWith("a", "", 50, true));
  expect((screen.getByRole("checkbox", { name: "Show hidden files" }) as HTMLInputElement).checked).toBe(true);
  expect(localStorage.getItem("golem.files.hidden")).toBe("1");
  page.stop();
});

test("typing asks for the list once, after a pause", async () => {
  const { fake, page } = setup();
  await screen.findByText("README.md");
  await userEvent.type(screen.getByRole("textbox", { name: "Find a file" }), "fetch");
  await waitFor(() => expect(fake.raw.listFiles).toHaveBeenCalledWith("a", "fetch", 50, false));
  expect(fake.raw.listFiles.mock.calls.filter(([, query]) => query !== "")).toHaveLength(1);
  await waitFor(() => expect(screen.queryByText("README.md")).toBeNull());
  expect(screen.queryByText("Changed in this session")).toBeNull();
  page.stop();
});

test("choosing a file shows its numbered lines under a header", async () => {
  const { fake, page } = setup();
  await userEvent.type(await screen.findByRole("textbox", { name: "Find a file" }), "fetch");
  await userEvent.click(await screen.findByTitle("src/fetch.py"));
  const region = await screen.findByRole("region", { name: "Contents of src/fetch.py" });
  expect(fake.raw.readFile).toHaveBeenCalledWith("a", "src/fetch.py");
  const rows = Array.from(region.querySelectorAll<HTMLElement>("[data-line]"));
  expect(rows.map((row) => row.dataset["line"])).toEqual(["1", "2", "3", "4"]);
  expect(within(rows[1]!).getByText("2")).toBeTruthy();
  // The file text is text: markup in it is not made into elements.
  expect(region.querySelector("b")).toBeNull();
  expect(region.textContent).toContain("<b>hi</b>");
  expect(screen.getByText("4 lines")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy path" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to the list" }));
  expect(screen.getByRole("textbox", { name: "Find a file" })).toBeTruthy();
  page.stop();
});

test("a known language gets coloured tokens, and Enter opens the first path", async () => {
  const { page } = setup();
  const box = await screen.findByRole("textbox", { name: "Find a file" });
  await screen.findByText("README.md");
  await userEvent.type(box, "fetch{Enter}");
  const region = await screen.findByRole("region", { name: "Contents of src/fetch.py" });
  await waitFor(() => expect(region.querySelector("[data-line='1'] span[style]")).toBeTruthy(), { timeout: 5000 });
  page.stop();
});

test("a cut file says so, and an error shows the daemon's message", async () => {
  const { fake, page } = setup();
  fake.raw.readFile.mockImplementation(async (_id, path) => {
    if (path === "src/socket.ts") return { path, text: "a\n", truncated: true, lines: 1 };
    throw new Error("logo.png looks like a binary file");
  });
  await userEvent.click(await screen.findByTitle("src/socket.ts"));
  expect(await screen.findByText("Only the first part of this file is shown.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back to the list" }));
  await userEvent.click(await screen.findByTitle("src/fetch.py"));
  expect(await screen.findByText("logo.png looks like a binary file")).toBeTruthy();
  page.stop();
});

test("openFile with a line scrolls that row into view and clears the request", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const { fake, page } = setup();
  await screen.findByText("README.md");
  act(() => openFile("src/fetch.py", 4));
  await screen.findByRole("region", { name: "Contents of src/fetch.py" });
  await waitFor(() => expect(scroll).toHaveBeenCalled());
  const row = scroll.mock.contexts.at(-1) as HTMLElement;
  expect(row.dataset["line"]).toBe("4");
  expect(fake.raw.readFile).toHaveBeenCalledWith("a", "src/fetch.py");
  page.stop();
});
