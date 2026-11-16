import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChangedFile } from "../../store/changes.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { diffModeStore } from "../diff/diff-mode.ts";
import { SAMPLE_EDIT_DIFF } from "../diff/sample.ts";
import { ChangesTab } from "./changes-tab.tsx";
import { requestCommit } from "./workbench-state.ts";
import { WORKBENCH_DEFAULT, workbenchWidthStore } from "./workbench-width.ts";

const FILES: ChangedFile[] = [
  { path: "src/socket.ts", status: "modified", added: 18, removed: 4, change_ids: ["c1"], stale: false },
  { path: "src/clamp.ts", status: "created", added: 3, removed: 0, change_ids: ["c2"], stale: false },
];

function setup(info: { repository: boolean; branch: string | null; paths: string[] } = { repository: true, branch: "main", paths: ["src/socket.ts", "src/clamp.ts"] }) {
  const fake = fakeClient();
  fake.raw.changesList.mockImplementation(async () => ({ files: FILES }));
  fake.raw.changesDiff.mockImplementation(async () => ({ diff: SAMPLE_EDIT_DIFF, truncated: false }));
  fake.raw.changesCommitInfo.mockImplementation(async () => info);
  fake.raw.changesSuggestMessage.mockImplementation(async () => ({ message: "Add the socket clamp" }));
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

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: "Commit…" }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  localStorage.clear();
  diffModeStore.set("unified");
  workbenchWidthStore.set(WORKBENCH_DEFAULT);
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("the button shows only in a repository that lists paths", async () => {
  const { page } = setup({ repository: false, branch: null, paths: [] });
  await screen.findByText("2 files");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Commit…" })).toBeNull());
  page.stop();
});

test("the dialog names the branch and lists every path, checked, and says the person commits", async () => {
  const { page } = setup();
  const dialog = await openDialog();
  expect(within(dialog).getByText("on main")).toBeTruthy();
  const boxes = within(dialog).getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes.map((box) => box.checked)).toEqual([true, true]);
  expect(within(dialog).getByText("src/socket.ts")).toBeTruthy();
  expect(within(dialog).getByText(/You are committing these files yourself/)).toBeTruthy();
  page.stop();
});

test("the suggestion fills the empty box, and Commit sends the files and the message", async () => {
  const { fake, page } = setup();
  const dialog = await openDialog();
  const box = within(dialog).getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  await waitFor(() => expect(box.value).toBe("Add the socket clamp"));
  expect(fake.raw.changesSuggestMessage).toHaveBeenCalledWith("a", ["src/socket.ts", "src/clamp.ts"]);
  expect(fake.raw.changesCommit).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Commit" }));
  await waitFor(() => expect(fake.raw.changesCommit).toHaveBeenCalledWith("a", ["src/socket.ts", "src/clamp.ts"], "Add the socket clamp"));
  await screen.findByText("Committed a1b2c3d");
  expect(screen.queryByRole("dialog")).toBeNull();
  page.stop();
});

test("unchecking a path leaves it out of the suggestion and the commit", async () => {
  const { fake, page } = setup();
  const dialog = await openDialog();
  const box = within(dialog).getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  await waitFor(() => expect(box.value).not.toBe(""));
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "src/clamp.ts" }));
  await waitFor(() => expect(fake.raw.changesSuggestMessage).toHaveBeenLastCalledWith("a", ["src/socket.ts"]));
  await userEvent.click(within(dialog).getByRole("button", { name: "Commit" }));
  await waitFor(() => expect(fake.raw.changesCommit).toHaveBeenCalledWith("a", ["src/socket.ts"], "Add the socket clamp"));
  page.stop();
});

test("a suggestion that arrives after the person typed does not replace their text", async () => {
  const fake = fakeClient();
  let answer: (message: string) => void = () => undefined;
  fake.raw.changesList.mockImplementation(async () => ({ files: FILES }));
  fake.raw.changesCommitInfo.mockImplementation(async () => ({ repository: true, branch: "main", paths: ["src/socket.ts"] }));
  fake.raw.changesSuggestMessage.mockImplementation(() => new Promise((resolve) => (answer = (message) => resolve({ message }))));
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }) as unknown as Document;
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <ChangesTab sessionId="a" />
    </PageProvider>,
  );
  const dialog = await openDialog();
  const box = within(dialog).getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  expect(box.placeholder).toBe("Suggesting…");
  await userEvent.type(box, "my words");
  await waitFor(() => expect(fake.raw.changesSuggestMessage).toHaveBeenCalled());
  await act(async () => answer("from the model"));
  expect(box.value).toBe("my words");
  page.stop();
});

test("Suggest again asks once more", async () => {
  const { fake, page } = setup();
  const dialog = await openDialog();
  const box = within(dialog).getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  await waitFor(() => expect(box.value).toBe("Add the socket clamp"));
  fake.raw.changesSuggestMessage.mockImplementation(async () => ({ message: "Clamp the socket" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Suggest again" }));
  await waitFor(() => expect(box.value).toBe("Clamp the socket"));
  expect(fake.raw.changesSuggestMessage).toHaveBeenCalledTimes(2);
  page.stop();
});

test("a failed commit keeps the dialog open and shows git's output", async () => {
  const { fake, page } = setup();
  fake.raw.changesCommit.mockImplementation(async () => ({ ok: false, sha: null, output: "hook failed: lint\nfix the warnings" }));
  const dialog = await openDialog();
  const box = within(dialog).getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  await waitFor(() => expect(box.value).not.toBe(""));
  await userEvent.click(within(dialog).getByRole("button", { name: "Commit" }));
  const shown = await within(dialog).findByText(/hook failed: lint/);
  expect(shown.tagName).toBe("PRE");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByText(/Committed/)).toBeNull();
  page.stop();
});

test("while a run is active Commit is disabled and nothing is sent", async () => {
  const { fake, page } = setup();
  act(() => fake.emitEvent(ev("a", "run.started")));
  const dialog = await openDialog();
  const box = within(dialog).getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  await waitFor(() => expect(box.value).not.toBe(""));
  expect((within(dialog).getByRole("button", { name: "Commit" }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(dialog).getByText("A run is active. Commit when it ends.")).toBeTruthy();
  expect(fake.raw.changesCommit).not.toHaveBeenCalled();
  page.stop();
});

test("/commit opens the dialog, and says so when there is nothing to commit", async () => {
  const { page } = setup({ repository: true, branch: "main", paths: [] });
  await screen.findByText("2 files");
  act(() => requestCommit());
  expect(await screen.findByText("Nothing to commit.")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  page.stop();
});

test("/commit opens the dialog in a repository", async () => {
  const { page } = setup();
  await screen.findByText("2 files");
  act(() => requestCommit());
  expect(await screen.findByRole("dialog")).toBeTruthy();
  page.stop();
});
