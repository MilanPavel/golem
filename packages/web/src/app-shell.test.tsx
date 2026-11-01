import { RpcError, SESSION_NOT_FOUND } from "@golem/client";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { App } from "./app.tsx";
import { createPage } from "./store/page.ts";
import { PageProvider } from "./store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "./store/test-support.ts";

const noContrast = {
  // jsdom does not compute colors, so contrast cannot be checked here.
  rules: { "color-contrast": { enabled: false } },
};

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

function setup(path = "/") {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, ...view };
}

function seed(fake: ReturnType<typeof fakeClient>) {
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"), title: "UTF-8 split", status: "waiting" });
    fake.emitSummary({ ...summary("b", "2026-11-01T10:00:00Z", "/Users/you/notes"), title: "PR digest" });
    fake.emitSummary({ ...summary("c", "2026-10-30T10:00:00Z", null), title: null });
    fake.emitSummary({ ...summary("d", "2026-11-01T09:00:00Z", "/Users/you/notes"), title: "Hidden", status: "closed" });
  });
}

afterEach(() => {
  history.replaceState(null, "", "/");
});

test("the empty screen: golem, the line, the folder chip, and no accessibility violations", async () => {
  const { fake, container } = setup("/");
  seed(fake);
  expect(screen.getByRole("heading", { level: 1, name: "Start a new session" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Folder: golem" })).toBeTruthy();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the sidebar groups sessions by folder, hides closed ones, and puts no folder last", () => {
  const { fake } = setup("/");
  seed(fake);
  const lists = screen.getAllByRole("list");
  expect(lists.map((list) => list.getAttribute("aria-labelledby") && document.getElementById(list.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
    "golem",
    "notes",
    "No folder",
  ]);
  expect(screen.queryByText("Hidden")).toBeNull();
  const notes = within(lists[1]!);
  expect(notes.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByText("Untitled")).toBeTruthy();
  expect(screen.getByText("waiting", { selector: ".sr-only" })).toBeTruthy();
});

test("the wordmark's state follows the sessions", () => {
  const { fake } = setup("/");
  expect(screen.getByText("idle", { selector: "span.font-mono" })).toBeTruthy();
  seed(fake);
  expect(screen.getByText("waiting for you")).toBeTruthy();
});

test("the selected session is current, and a click navigates without a page load", async () => {
  const user = userEvent.setup();
  const { fake } = setup("/s/b");
  seed(fake);
  await wait();
  const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
  expect(current).toHaveLength(1);
  expect(current[0]!.textContent).toContain("PR digest");

  let prevented = false;
  document.addEventListener("click", (event) => (prevented = event.defaultPrevented), { once: true });
  await user.click(screen.getByRole("link", { name: /UTF-8 split/ }));
  expect(prevented).toBe(true);
  expect(location.pathname).toBe("/s/a");
  expect(screen.getByRole("link", { name: /UTF-8 split/ }).getAttribute("aria-current")).toBe("page");
});

test("New session goes to the empty screen", async () => {
  const user = userEvent.setup();
  setup("/s/b");
  await user.click(screen.getByRole("button", { name: /New session/ }));
  expect(location.pathname).toBe("/");
  expect(screen.getByRole("heading", { name: "Start a new session" })).toBeTruthy();
});

test("a session shows its title, model, and folder, and attaches", async () => {
  const { fake, container } = setup("/s/a");
  seed(fake);
  await wait();
  act(() => {
    fake.emitEvent(ev("a", "session.created", { cwd: "/Users/you/repos/golem", model_profile: "local", model_name: "qwen3-coder:30b" }));
  });
  expect(fake.raw.attachSession).toHaveBeenCalledWith("a");
  expect(screen.getByRole("heading", { level: 1, name: "UTF-8 split" })).toBeTruthy();
  expect(screen.getByText("qwen3-coder:30b")).toBeTruthy();
  const folder = screen.getByText("golem", { selector: "[title]" });
  expect(folder.getAttribute("title")).toBe("/Users/you/repos/golem");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("an unnamed session is New session", async () => {
  const { fake } = setup("/s/c");
  seed(fake);
  await wait();
  expect(screen.getByRole("heading", { level: 1, name: "New session" })).toBeTruthy();
});

test("a session the daemon does not have says so, and the button goes back", async () => {
  const user = userEvent.setup();
  history.replaceState(null, "", "/s/zzz");
  const fake = fakeClient();
  fake.raw.attachSession.mockRejectedValueOnce(new RpcError(SESSION_NOT_FOUND, "no such session"));
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const { container } = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  await wait();
  expect(screen.getByRole("heading", { level: 1, name: "This session is gone" })).toBeTruthy();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Back to start" }));
  expect(location.pathname).toBe("/");
});

test("an unknown address is not found, with a link to the start", async () => {
  const user = userEvent.setup();
  const { container } = setup("/nowhere");
  expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  await user.click(screen.getByRole("link", { name: "Go to the start" }));
  expect(location.pathname).toBe("/");
});

test("the folder chip defaults to the last opened session's folder", async () => {
  const user = userEvent.setup();
  const { fake } = setup("/s/b");
  seed(fake);
  await wait();
  await user.click(screen.getByRole("button", { name: /New session/ }));
  expect(screen.getByRole("button", { name: "Folder: notes" })).toBeTruthy();
});

test("the folder chip lists the folders and picks one", async () => {
  const user = userEvent.setup();
  const { fake } = setup("/");
  seed(fake);
  await user.click(screen.getByRole("button", { name: "Folder: golem" }));
  expect(screen.getByRole("menuitem", { name: "/Users/you/repos/golem" })).toBeTruthy();
  await user.click(screen.getByRole("menuitem", { name: "/Users/you/notes" }));
  expect(screen.getByRole("button", { name: "Folder: notes" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Folder: notes" }));
  await user.click(screen.getByRole("menuitem", { name: "No folder" }));
  expect(screen.getByRole("button", { name: "Folder: No folder" })).toBeTruthy();
});

test("Type a path accepts an absolute path and rejects any other", async () => {
  const user = userEvent.setup();
  const { fake } = setup("/");
  seed(fake);
  await user.click(screen.getByRole("button", { name: "Folder: golem" }));
  await user.click(screen.getByRole("menuitem", { name: "Type a path…" }));
  const input = await screen.findByRole("textbox", { name: "Folder path" });
  await user.clear(input);
  await user.type(input, "relative/dir");
  await user.click(screen.getByRole("button", { name: "Use this folder" }));
  expect(screen.getByRole("alert").textContent).toContain("absolute path");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  await user.clear(input);
  await user.type(input, "  /tmp/work  ");
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Use this folder" }));
  expect(screen.getByRole("button", { name: "Folder: work" }).getAttribute("title")).toBe("/tmp/work");
});
