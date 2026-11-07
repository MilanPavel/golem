import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { FsListDirsResult } from "../../store/dirs.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, INVALID_PARAMS_CODE, rpcError, summary } from "../../store/test-support.ts";
import { crumbs, FolderBrowserView, looksLikePath, resolveTyped, underHome, type FolderBrowserViewProps } from "./folder-browser.tsx";

const HOME = "/home/me";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function listing(path: string, names: string[], extra: Partial<FsListDirsResult> = {}): FsListDirsResult {
  return {
    path,
    home: HOME,
    parent: path === HOME ? null : path.slice(0, path.lastIndexOf("/")) || HOME,
    entries: names.map((name) => ({ name, path: `${path}/${name}`, git: name === "golem" || name === "code" })),
    truncated: false,
    ...extra,
  };
}

const TREE: Record<string, FsListDirsResult> = {
  [HOME]: listing(HOME, ["code", "notes", "Photos"]),
  [`${HOME}/code`]: listing(`${HOME}/code`, ["golem", "web"]),
  [`${HOME}/code/golem`]: listing(`${HOME}/code/golem`, []),
};

function setup(cwd: string | null = "/Users/you/repos/golem") {
  history.replaceState(null, "", "/");
  const fake = fakeClient();
  fake.raw.listDirs.mockImplementation(async (path?: string) => {
    const found = TREE[path ?? HOME];
    if (found === undefined) throw rpcError(INVALID_PARAMS_CODE, `There is no folder at ${path}.`);
    return found;
  });
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
  act(() => fake.emitSummary(summary("x", "2026-11-01T11:59:00Z", cwd)));
  return { fake, ...view, user: userEvent.setup() };
}

async function openBrowser(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Folder:/ }));
  await user.click(screen.getByRole("menuitem", { name: "Choose a folder…" }));
  return screen.findByRole("dialog", { name: "Choose a folder" });
}

const filter = (dialog: HTMLElement) => within(dialog).getByRole("combobox", { name: "Filter, or type a path" }) as HTMLInputElement;
const optionNames = (dialog: HTMLElement) => within(dialog).queryAllByRole("option").map((option) => option.textContent);

afterEach(() => {
  history.replaceState(null, "", "/");
});

// The pure helpers

test("path helpers: what looks like a path, where it goes, and the breadcrumb", () => {
  expect(["/tmp", " /tmp", "~", "~/code"].every(looksLikePath)).toBe(true);
  expect(["code", "", "a/b"].some(looksLikePath)).toBe(false);
  expect(resolveTyped("~/code", HOME)).toBe("/home/me/code");
  expect(resolveTyped("~", HOME)).toBe("/home/me");
  expect(resolveTyped("~/code", null)).toBeNull();
  expect(resolveTyped("  /tmp/work/  ", HOME)).toBe("/tmp/work");
  expect(resolveTyped("/", HOME)).toBe("/");
  expect(resolveTyped("work", HOME)).toBeNull();
  expect(underHome("/home/me", HOME)).toBe(true);
  expect(underHome("/home/me/code", HOME)).toBe(true);
  expect(underHome("/home/melon", HOME)).toBe(false);
  expect(crumbs({ path: HOME, home: HOME })).toEqual([{ label: "~", path: HOME }]);
  expect(crumbs({ path: `${HOME}/code/golem`, home: HOME })).toEqual([
    { label: "~", path: HOME },
    { label: "code", path: `${HOME}/code` },
    { label: "golem", path: `${HOME}/code/golem` },
  ]);
});

// The view

function view(props: Partial<FolderBrowserViewProps> = {}) {
  const handlers = {
    onQueryChange: vi.fn(),
    onOpen: vi.fn(),
    onUp: vi.fn(),
    onGoTyped: vi.fn(),
    onRetry: vi.fn(),
    onPick: vi.fn(),
    onCancel: vi.fn(),
  };
  const result = render(
    <FolderBrowserView listing={TREE[`${HOME}/code`]!} loading={false} error={null} query="" {...handlers} {...props} />,
  );
  return { ...handlers, ...result };
}

test("the view shows the breadcrumb, the folders with their git badges, and the two buttons", async () => {
  const { onOpen, onPick, onCancel } = view();
  const nav = screen.getByRole("navigation", { name: "Folder path" });
  expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(["~", "code"]);
  expect(within(nav).getByRole("button", { name: "code" }).getAttribute("aria-current")).toBe("location");
  await userEvent.click(within(nav).getByRole("button", { name: "~" }));
  expect(onOpen).toHaveBeenCalledWith(HOME);
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["golemgit", "web"]);
  await userEvent.click(screen.getByRole("option", { name: "web" }));
  expect(onOpen).toHaveBeenLastCalledWith(`${HOME}/code/web`);
  await userEvent.click(screen.getByRole("button", { name: "Use this folder" }));
  expect(onPick).toHaveBeenCalledWith(`${HOME}/code`);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalled();
});

test("the filter narrows the list without regard to case, and says when nothing matches", () => {
  const { rerender, ...handlers } = view({ query: "GO" });
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["golemgit"]);
  rerender(<FolderBrowserView listing={TREE[`${HOME}/code`]!} loading={false} error={null} query="zzz" {...handlers} />);
  expect(screen.getByText("No matching folders.")).toBeTruthy();
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("the keys: Down moves, Enter and Right open, Left and Backspace in an empty filter go up", async () => {
  const { onOpen, onUp } = view();
  const field = screen.getByRole("combobox", { name: "Filter, or type a path" });
  await userEvent.click(field);
  expect(field.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0]!.id);
  await userEvent.keyboard("{ArrowDown}");
  expect(field.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]!.id);
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenLastCalledWith(`${HOME}/code/web`);
  await userEvent.keyboard("{ArrowUp}{ArrowRight}");
  expect(onOpen).toHaveBeenLastCalledWith(`${HOME}/code/golem`);
  await userEvent.keyboard("{ArrowLeft}");
  expect(onUp).toHaveBeenCalledTimes(1);
  await userEvent.keyboard("{Backspace}");
  expect(onUp).toHaveBeenCalledTimes(2);
});

test("with text in the filter, Left and Backspace edit it, and Right moves the caret", async () => {
  function Holder() {
    const [query, setQuery] = useState("");
    return <FolderBrowserView listing={TREE[`${HOME}/code`]!} loading={false} error={null} query={query} onQueryChange={setQuery} onOpen={onOpen} onUp={onUp} onGoTyped={() => {}} onRetry={() => {}} onPick={() => {}} onCancel={() => {}} />;
  }
  const onOpen = vi.fn();
  const onUp = vi.fn();
  render(<Holder />);
  const field = screen.getByRole("combobox", { name: "Filter, or type a path" }) as HTMLInputElement;
  await userEvent.type(field, "we{ArrowLeft}{Backspace}");
  expect(field.value).toBe("e");
  expect(onUp).not.toHaveBeenCalled();
  await userEvent.keyboard("{ArrowRight}");
  expect(onOpen).not.toHaveBeenCalled();
});

test("a value that is a path sends Enter to onGoTyped, and does not filter", async () => {
  const { onGoTyped, onOpen } = view({ query: "~/code" });
  expect(screen.getAllByRole("option")).toHaveLength(2);
  await userEvent.click(screen.getByRole("combobox", { name: "Filter, or type a path" }));
  await userEvent.keyboard("{Enter}");
  expect(onGoTyped).toHaveBeenCalledWith("~/code");
  expect(onOpen).not.toHaveBeenCalled();
});

test("loading, error with Retry, empty, and truncated", async () => {
  const loading = view({ listing: null, loading: true });
  expect(screen.getByText("loading…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Use this folder" }).hasAttribute("disabled")).toBe(true);
  loading.unmount();
  const failed = view({ listing: null, error: "golem can't read /home/me/x." });
  expect(screen.getByRole("alert").textContent).toContain("golem can't read /home/me/x.");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(failed.onRetry).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Use this folder" }).hasAttribute("disabled")).toBe(true);
  failed.unmount();
  const empty = view({ listing: TREE[`${HOME}/code/golem`]! });
  expect(screen.getByText("No folders here.")).toBeTruthy();
  empty.unmount();
  view({ listing: { ...TREE[HOME]!, truncated: true } });
  expect(screen.getByText("Showing the first 500 folders. Type to narrow.")).toBeTruthy();
});

// On the page

test("Choose a folder… opens a popover at home when the current folder is not under it", async () => {
  const { fake, user } = setup();
  const dialog = await openBrowser(user);
  await waitFor(() => expect(optionNames(dialog)).toEqual(["codegit", "notes", "Photos"]));
  expect(fake.raw.listDirs).toHaveBeenCalledWith("/Users/you/repos/golem");
  expect(fake.raw.listDirs).toHaveBeenLastCalledWith();
  expect(within(dialog).getByRole("navigation", { name: "Folder path" }).textContent).toBe("~");
  await waitFor(() => expect(document.activeElement).toBe(filter(dialog)));
});

test("it opens at the current folder when that is under home", async () => {
  const { user } = setup(`${HOME}/code`);
  const dialog = await openBrowser(user);
  await waitFor(() => expect(optionNames(dialog)).toEqual(["golemgit", "web"]));
  expect(within(dialog).getByRole("navigation", { name: "Folder path" }).textContent).toBe("~/code");
});

test("browsing into a folder and Use this folder sets the new session's folder", async () => {
  const { user } = setup();
  const dialog = await openBrowser(user);
  await user.click(await within(dialog).findByRole("option", { name: /code/ }));
  await user.click(await within(dialog).findByRole("option", { name: /golem/ }));
  await waitFor(() => expect(within(dialog).getByRole("navigation", { name: "Folder path" }).textContent).toBe("~/code/golem"));
  await user.click(within(dialog).getByRole("button", { name: "Use this folder" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a folder" })).toBeNull());
  expect(screen.getByRole("button", { name: "Folder: golem" }).getAttribute("title")).toBe(`${HOME}/code/golem`);
});

test("the keyboard walks the tree from the filter, and Escape closes without a change", async () => {
  const { user } = setup();
  const dialog = await openBrowser(user);
  await within(dialog).findByRole("option", { name: /code/ });
  await waitFor(() => expect(document.activeElement).toBe(filter(dialog)));
  await user.keyboard("{Enter}");
  await waitFor(() => expect(optionNames(dialog)).toEqual(["golemgit", "web"]));
  await user.keyboard("{Backspace}");
  await waitFor(() => expect(optionNames(dialog)).toEqual(["codegit", "notes", "Photos"]));
  await user.keyboard("pho{Enter}");
  await wait();
  expect(within(dialog).getByRole("alert").textContent).toContain("There is no folder at");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a folder" })).toBeNull());
  expect(screen.getByRole("button", { name: "Folder: golem" })).toBeTruthy();
});

test("a typed path under home goes there, and one outside home is used as typed", async () => {
  const { user } = setup();
  const dialog = await openBrowser(user);
  await within(dialog).findByRole("option", { name: /code/ });
  await user.type(filter(dialog), "~/code{Enter}");
  await waitFor(() => expect(optionNames(dialog)).toEqual(["golemgit", "web"]));
  expect(filter(dialog).value).toBe("");
  await user.type(filter(dialog), "/tmp/work{Enter}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a folder" })).toBeNull());
  expect(screen.getByRole("button", { name: "Folder: work" }).getAttribute("title")).toBe("/tmp/work");
});

test("Cancel closes the browser and leaves the folder", async () => {
  const { user } = setup();
  const dialog = await openBrowser(user);
  await within(dialog).findByRole("option", { name: /code/ });
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a folder" })).toBeNull());
  expect(screen.getByRole("button", { name: "Folder: golem" })).toBeTruthy();
});

test("a failed listing shows its line, and Retry asks again", async () => {
  const { fake, user } = setup();
  fake.raw.listDirs.mockRejectedValue(rpcError(INVALID_PARAMS_CODE, "golem can't read /home/me."));
  const dialog = await openBrowser(user);
  expect((await within(dialog).findByRole("alert")).textContent).toContain("golem can't read /home/me.");
  fake.raw.listDirs.mockImplementation(async () => TREE[HOME]!);
  await user.click(within(dialog).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(optionNames(dialog)).toEqual(["codegit", "notes", "Photos"]));
});

test("the browser has no accessibility violations", async () => {
  const { user } = setup();
  const dialog = await openBrowser(user);
  await within(dialog).findByRole("option", { name: /code/ });
  const rules = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
  expect((await axe.run(document.body, rules)).violations).toEqual([]);
});
