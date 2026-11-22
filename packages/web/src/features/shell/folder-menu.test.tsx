import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { GitInfoResult } from "../../store/dirs.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { SessionFolderMenuBody } from "../composer/index.ts";
import { FolderMenuBody } from "./folder-menu.tsx";

const HOME = "/home/me";
const GOLEM = `${HOME}/repos/golem`;
const NOTES = `${HOME}/notes`;
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

const NOT_A_REPO: GitInfoResult = { repository: false, branch: null, root: null, detached: false, changed: 0, worktrees: [] };
const GOLEM_INFO: GitInfoResult = {
  repository: true,
  branch: "main",
  root: GOLEM,
  detached: false,
  changed: 0,
  worktrees: [
    { path: GOLEM, branch: "main", main: true, agent: false },
    { path: `${HOME}/repos/golem-review`, branch: "review", main: false, agent: false },
    { path: `${GOLEM}/.claude/worktrees/agent-a`, branch: "worktree-agent-a", main: false, agent: true },
    { path: `${GOLEM}/.claude/worktrees/agent-b`, branch: "worktree-agent-b", main: false, agent: true },
  ],
};

function setup({ localUi = false, info = GOLEM_INFO }: { localUi?: boolean; info?: GitInfoResult } = {}) {
  history.replaceState(null, "", "/");
  const fake = fakeClient();
  fake.raw.localUi = localUi;
  fake.raw.listDirs.mockImplementation(async () => ({ path: HOME, home: HOME, parent: null, entries: [], truncated: false }));
  fake.raw.gitInfo.mockImplementation(async (path: string) => (path === GOLEM ? info : path === `${HOME}/other` ? { ...NOT_A_REPO, repository: true, branch: "dev" } : NOT_A_REPO));
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.setupStart.decide();
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary(summary("x", "2026-11-01T11:59:00Z", GOLEM));
    fake.emitSummary(summary("y", "2026-11-01T11:00:00Z", NOTES));
    fake.emitSummary(summary("z", "2026-11-01T10:00:00Z", `${HOME}/other`));
  });
  return { fake, page, ...view, user: userEvent.setup() };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Folder:/ }));
  const dialog = await screen.findByRole("dialog", { name: "Folder" });
  await wait();
  return dialog;
}

const field = (dialog: HTMLElement) => within(dialog).getByRole("combobox", { name: "Filter, or type a path" }) as HTMLInputElement;
const names = (dialog: HTMLElement) => within(dialog).queryAllByRole("option").map((option) => option.textContent ?? "");

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
});

test("the menu opens with the field focused, the current folder with its branch, and the recent folders", async () => {
  const { user } = setup();
  await wait();
  const dialog = await openMenu(user);
  expect(document.activeElement).toBe(field(dialog));
  expect(within(dialog).getByRole("group", { name: "Current" }).textContent).toContain("golem");
  expect(within(dialog).getByRole("group", { name: "Current" }).textContent).toContain("main");
  const recent = within(dialog).getByRole("group", { name: "Recent" });
  expect(within(recent).getAllByRole("option").map((o) => o.textContent)).toEqual([
    expect.stringContaining("notes"),
    expect.stringContaining("other"),
    expect.stringContaining("No folder"),
  ]);
  expect(recent.textContent).toContain("dev");
});

test("plain text in the field filters the lists", async () => {
  const { user } = setup();
  await wait();
  const dialog = await openMenu(user);
  await user.type(field(dialog), "note");
  const list = names(dialog);
  expect(list.some((text) => text.includes("notes"))).toBe(true);
  expect(list.some((text) => text.includes("other"))).toBe(false);
  await user.clear(field(dialog));
  await user.type(field(dialog), "zzz");
  expect(screen.getByText(/No folder matches “zzz”/)).toBeTruthy();
});

test("a typed ~/x shows Use ~/x, and Enter sets the folder", async () => {
  const { user } = setup();
  await wait();
  const dialog = await openMenu(user);
  await user.type(field(dialog), "~/x");
  expect(names(dialog)[0]).toContain("Use ~/x");
  // The lists are gone while a path is typed.
  expect(within(dialog).queryByRole("group", { name: "Recent" })).toBeNull();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.getByRole("button", { name: "Folder: x" })).toBeTruthy());
  expect(screen.queryByRole("dialog", { name: "Folder" })).toBeNull();
});

test("the arrow keys move and Enter picks a recent folder", async () => {
  const { user } = setup();
  await wait();
  const dialog = await openMenu(user);
  await user.keyboard("{ArrowDown}");
  expect(within(dialog).getAllByRole("option", { selected: true })[0]!.textContent).toContain("notes");
  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: "Folder: notes" })).toBeTruthy();
});

test("Esc closes the menu and leaves the folder", async () => {
  const { user } = setup();
  await wait();
  await openMenu(user);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Folder" })).toBeNull();
  expect(screen.getByRole("button", { name: "Folder: golem" })).toBeTruthy();
});

test("worktrees show for a repo with more than one, and the agent worktrees fold into one row", async () => {
  const { user } = setup();
  await wait();
  const dialog = await openMenu(user);
  const trees = within(dialog).getByRole("group", { name: "Worktrees of golem" });
  expect(within(trees).getAllByRole("option").map((o) => o.textContent)).toEqual([
    expect.stringContaining("golem-review"),
    expect.stringContaining("2 agent worktrees"),
  ]);
  await user.click(within(trees).getByRole("option", { name: /2 agent worktrees/ }));
  expect(within(trees).getAllByRole("option")).toHaveLength(4);
  await user.click(within(trees).getByRole("option", { name: /agent-a/ }));
  expect(screen.getByRole("button", { name: "Folder: agent-a" })).toBeTruthy();
});

test("a repo with one worktree has no worktrees list", async () => {
  const { user } = setup({ info: { ...GOLEM_INFO, worktrees: [GOLEM_INFO.worktrees[0]!] } });
  await wait();
  const dialog = await openMenu(user);
  expect(within(dialog).queryByRole("group", { name: /^Worktrees of/ })).toBeNull();
});

test("Choose folder… calls the method from the current folder and sets the path", async () => {
  const { user, fake } = setup({ localUi: true });
  await wait();
  fake.raw.chooseFolder.mockResolvedValue({ path: "/home/me/picked" });
  const dialog = await openMenu(user);
  expect(within(dialog).queryByRole("option", { name: "Browse…" })).toBeNull();
  await user.click(within(dialog).getByRole("option", { name: /^Choose folder…/ }));
  expect(fake.raw.chooseFolder).toHaveBeenCalledWith(GOLEM);
  await waitFor(() => expect(screen.getByRole("button", { name: "Folder: picked" })).toBeTruthy());
});

test("while the dialog is open the menu waits, and Cancel stops waiting and leaves the folder", async () => {
  const { user, fake } = setup({ localUi: true });
  await wait();
  let answer: (value: { path: string | null }) => void = () => {};
  fake.raw.chooseFolder.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
  const dialog = await openMenu(user);
  await user.click(within(dialog).getByRole("option", { name: /^Choose folder…/ }));
  expect(await within(dialog).findByText("Waiting for the folder dialog on your Mac…")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(within(dialog).getByRole("combobox", { name: "Filter, or type a path" })).toBeTruthy();
  // The dialog answers later: the answer is dropped.
  await act(async () => answer({ path: "/home/me/late" }));
  expect(screen.getByRole("button", { name: "Folder: golem" })).toBeTruthy();
});

test("a dialog the person cancels leaves the folder alone", async () => {
  const { user, fake } = setup({ localUi: true });
  await wait();
  fake.raw.chooseFolder.mockResolvedValue({ path: null });
  const dialog = await openMenu(user);
  await user.click(within(dialog).getByRole("option", { name: /^Choose folder…/ }));
  expect(await within(dialog).findByRole("combobox", { name: "Filter, or type a path" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Folder: golem" })).toBeTruthy();
});

test("a refused dialog shows the reason in the menu", async () => {
  const { user, fake } = setup({ localUi: true });
  await wait();
  fake.raw.chooseFolder.mockRejectedValue(rpcError(-32024, "busy", { reason: "busy" }));
  const dialog = await openMenu(user);
  await user.click(within(dialog).getByRole("option", { name: /^Choose folder…/ }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe("A folder dialog is already open on your Mac.");
});

test("without the flag the item reads Browse… and opens the in-app browser", async () => {
  const { user, fake } = setup({ localUi: false });
  await wait();
  const dialog = await openMenu(user);
  expect(within(dialog).queryByRole("option", { name: /Choose folder/ })).toBeNull();
  expect(within(dialog).queryByRole("option", { name: "Browse in golem" })).toBeNull();
  await user.click(within(dialog).getByRole("option", { name: "Browse…" }));
  expect(await screen.findByRole("dialog", { name: "Choose a folder" })).toBeTruthy();
  expect(fake.raw.chooseFolder).not.toHaveBeenCalled();
});

test("with the flag, Browse in golem opens the in-app browser", async () => {
  const { user } = setup({ localUi: true });
  await wait();
  const dialog = await openMenu(user);
  await user.click(within(dialog).getByRole("option", { name: "Browse in golem" }));
  expect(await screen.findByRole("dialog", { name: "Choose a folder" })).toBeTruthy();
});

test("Open in Finder shows with the flag, calls the action with the folder and closes the menu", async () => {
  const { user, fake } = setup({ localUi: true });
  await wait();
  const dialog = await openMenu(user);
  await user.click(within(dialog).getByRole("option", { name: "Open golem in Finder" }));
  expect(fake.raw.reveal).toHaveBeenCalledWith(GOLEM);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Folder" })).toBeNull());
});

test("Open in Finder is absent without the flag", async () => {
  const { user } = setup({ localUi: false });
  await wait();
  const dialog = await openMenu(user);
  expect(within(dialog).queryByRole("option", { name: /in Finder/ })).toBeNull();
});

test("a folder that did not open in Finder shows the line and keeps the menu open", async () => {
  const { user, fake } = setup({ localUi: true });
  await wait();
  fake.raw.reveal.mockRejectedValue(rpcError(-32602, "There is no folder at /home/me/repos/golem."));
  const dialog = await openMenu(user);
  await user.click(within(dialog).getByRole("option", { name: "Open golem in Finder" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe("There is no folder at /home/me/repos/golem.");
  expect(screen.getByRole("dialog", { name: "Folder" })).toBeTruthy();
});

test("a page that is not on the Mac gets the short line", async () => {
  const { user, fake } = setup({ localUi: true });
  await wait();
  fake.raw.reveal.mockRejectedValue(rpcError(-32022, "not local", { reason: "not_local" }));
  const dialog = await openMenu(user);
  await user.click(within(dialog).getByRole("option", { name: "Open golem in Finder" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe("Finder is not available here. It opens only on the Mac that runs golem.");
});

// The menu of an open session

test("an open session's menu offers Open in Finder with the flag, and shows an error", async () => {
  const { user, fake } = await openSession(true);
  await user.click(await screen.findByRole("button", { name: "Folder: golem" }));
  const dialog = await screen.findByRole("dialog", { name: "This session's folder" });
  fake.raw.reveal.mockRejectedValueOnce(rpcError(-32023, "unsupported", { reason: "unsupported" }));
  await user.click(within(dialog).getByRole("button", { name: "Open in Finder" }));
  expect(fake.raw.reveal).toHaveBeenCalledWith(GOLEM);
  expect((await within(dialog).findByRole("alert")).textContent).toContain("Finder is not available here.");
  await user.click(within(dialog).getByRole("button", { name: "Open in Finder" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "This session's folder" })).toBeNull());
});

async function openSession(localUi = false) {
  const view = setup({ localUi });
  await wait();
  act(() => {
    view.fake.emitEvent(ev("x", "session.created", { cwd: GOLEM, model_profile: "local", model_name: "m", title: "Work" }));
  });
  view.page.router.navigate("/s/x");
  await wait();
  return view;
}

test("an open session's menu is read only: its folder, the line about it, and three ways to start another", async () => {
  const { user } = await openSession();
  await user.click(await screen.findByRole("button", { name: "Folder: golem" }));
  const dialog = await screen.findByRole("dialog", { name: "This session's folder" });
  expect(dialog.textContent).toContain("A session keeps its folder. To work elsewhere, start a new one.");
  expect(within(dialog).queryByRole("combobox")).toBeNull();
  expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
  expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["Copy path", "New session in this folder", "New session in another folder…"]);
  await waitFor(() => expect(dialog.textContent).toContain("main"));
});

test("New session in this folder goes home with the folder set", async () => {
  const { user, page } = await openSession();
  await user.click(await screen.findByRole("button", { name: "Folder: golem" }));
  await user.click(await screen.findByRole("button", { name: "New session in this folder" }));
  await wait();
  expect(page.router.getSnapshot().name).toBe("home");
  expect(screen.getByRole("button", { name: "Folder: golem" })).toBeTruthy();
});

test("New session in another folder goes home with the folder menu open", async () => {
  const { user, page } = await openSession();
  await user.click(await screen.findByRole("button", { name: "Folder: golem" }));
  await user.click(await screen.findByRole("button", { name: "New session in another folder…" }));
  expect(await screen.findByRole("dialog", { name: "Folder" })).toBeTruthy();
  expect(page.router.getSnapshot().name).toBe("home");
});

// Axe, on the views

test("both menus have no accessibility violations", async () => {
  const { container } = render(
    <>
      <div aria-label="new" role="group">
        <FolderMenuBody
          folder={GOLEM}
          branch="main"
          recent={[{ path: NOTES, branch: null }]}
          worktrees={{ repo: "golem", rows: [{ path: `${GOLEM}-review`, branch: "review" }], agents: [{ path: `${GOLEM}/.claude/worktrees/a`, branch: "a" }] }}
          home={HOME}
          onPick={() => {}}
          onChoose={() => {}}
          onReveal={() => {}}
          onBrowse={() => {}}
          autoFocus={false}
        />
      </div>
      <div aria-label="session" role="group">
        <SessionFolderMenuBody folder={GOLEM} branch="main" onCopy={() => {}} onReveal={() => {}} error="Finder is not available here." onNewHere={() => {}} onNewElsewhere={() => {}} />
      </div>
    </>,
  );
  const result = await axe.run(container);
  expect(result.violations).toEqual([]);
});
