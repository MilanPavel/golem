import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { rpcError, ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
// A menu or dialog is portaled out of the landmarks, so the region rule does not apply to it.
const popup = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const CWD = "/Users/you/repos/golem";

function setup() {
  history.replaceState(null, "", "/s/a");
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
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split", last_seq: 2 });
    fake.emitSummary({ ...summary("b", "2026-11-01T11:00:00Z", CWD), title: "Other work", last_seq: 2 });
    fake.emitSummary({ ...summary("c", "2026-11-01T11:30:00Z", CWD), title: "Fork of it", forked_from: "a", last_seq: 2 });
  });
  return { fake, page, ...view };
}

async function open(finished = true) {
  const view = setup();
  await wait();
  act(() => {
    view.fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_name: "m", title: "UTF-8 split" }));
    if (finished) {
      view.fake.emitEvent(ev("a", "message.completed", { message_id: "m_1", role: "user", text: "hi" }));
      view.fake.emitEvent(ev("a", "message.completed", { message_id: "m_2", role: "assistant", text: "hello" }));
    }
  });
  return view;
}

const banner = () => within(screen.getByRole("banner"));
const titleButton = () => banner().getByRole("button", { name: /^Session actions: / });

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("the title is a menu button named for the session, with Rename, Fork, and Close", async () => {
  const user = userEvent.setup();
  await open();
  const button = titleButton();
  expect(button.getAttribute("aria-label")).toBe("Session actions: UTF-8 split");
  expect(button.textContent).toBe("UTF-8 split");
  await user.click(button);
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Rename", "Fork", "Close"]);
});

test("Rename: Enter saves what was typed, and the title changes only when the daemon says so", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  const field = screen.getByRole("textbox", { name: "Session title" }) as HTMLInputElement;
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe("UTF-8 split");
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
  expect(field.maxLength).toBe(60);
  await user.keyboard("A better name{Enter}");
  expect(fake.raw.renameSession).toHaveBeenCalledWith("a", "A better name");
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Session title" })).toBeNull());
  expect(titleButton().getAttribute("aria-label")).toBe("Session actions: UTF-8 split");
  await waitFor(() => expect(document.activeElement).toBe(titleButton()));
  act(() => {
    fake.emitEvent(ev("a", "session.updated", { title: "A better name" }));
  });
  expect(titleButton().getAttribute("aria-label")).toBe("Session actions: A better name");
});

test("Rename: the field is read-only while saving", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  let finish = () => {};
  fake.raw.renameSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ title: "x" } as never);
      }),
  );
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.keyboard("x{Enter}");
  expect((screen.getByRole("textbox", { name: "Session title" }) as HTMLInputElement).readOnly).toBe(true);
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Session title" })).toBeNull());
});

test("Rename: Esc cancels, saves nothing, and puts focus back on the trigger", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.keyboard("typed{Escape}");
  expect(screen.queryByRole("textbox", { name: "Session title" })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(titleButton()));
  expect(fake.raw.renameSession).not.toHaveBeenCalled();
});

test("Rename: empty text and unchanged text save nothing", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("textbox", { name: "Session title" })).toBeNull();
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.clear(screen.getByRole("textbox", { name: "Session title" }));
  await user.keyboard("   {Enter}");
  expect(screen.queryByRole("textbox", { name: "Session title" })).toBeNull();
  expect(fake.raw.renameSession).not.toHaveBeenCalled();
});

test("Rename: leaving the field cancels it without taking focus back", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.keyboard("typed");
  await user.click(banner().getByRole("button", { name: /^(Show|Hide) details$/ }));
  expect(screen.queryByRole("textbox", { name: "Session title" })).toBeNull();
  expect(fake.raw.renameSession).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(titleButton());
});

test("Rename: a refusal shows its message and keeps the field", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  fake.raw.renameSession.mockRejectedValueOnce(rpcError(-32003, "session not found"));
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.keyboard("x{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe("session not found");
  expect((screen.getByRole("textbox", { name: "Session title" }) as HTMLInputElement).readOnly).toBe(false);
});

test("a rename from another client shows in the sidebar and the top bar", async () => {
  const { fake } = await open();
  const sidebar = screen.getByRole("complementary", { name: "Sessions" });
  expect(within(sidebar).getByRole("link", { name: /^(?!.*fork of).*UTF-8 split/ })).toBeTruthy();
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:30Z", CWD), title: "Renamed in the TUI", last_seq: 3 });
  });
  expect(within(sidebar).getByRole("link", { name: /^(?!.*fork of).*Renamed in the TUI/ })).toBeTruthy();
  expect(within(sidebar).getByRole("link", { name: /fork of Renamed in the TUI/ })).toBeTruthy();
  expect(titleButton().getAttribute("aria-label")).toBe("Session actions: Renamed in the TUI");
});

test("Fork calls the client at the newest finished message and opens the new session", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Fork" }));
  expect(fake.raw.forkSession).toHaveBeenCalledWith("a", "m_2");
  await waitFor(() => expect(location.pathname).toBe("/s/s_fork"));
});

test("Fork is disabled until a message has finished", async () => {
  const user = userEvent.setup();
  const { fake } = await open(false);
  await user.click(titleButton());
  const item = screen.getByRole("menuitem", { name: "Fork" });
  expect(item.getAttribute("aria-disabled")).toBe("true");
  await user.click(item);
  expect(fake.raw.forkSession).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/s/a");
});

test("a failed fork shows its message and stays on the session", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  fake.raw.forkSession.mockRejectedValueOnce(rpcError(-32007, "cannot fork there"));
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Fork" }));
  expect((await screen.findByRole("alert")).textContent).toBe("cannot fork there");
  expect(location.pathname).toBe("/s/a");
});

test("Close asks first, then closes and goes to the start page", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Close" }));
  const dialog = screen.getByRole("dialog", { name: "Close this session?" });
  expect(within(dialog).getByText(/history stays in the log/)).toBeTruthy();
  expect(fake.raw.closeSession).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(fake.raw.closeSession).toHaveBeenCalledWith("a");
  await waitFor(() => expect(location.pathname).toBe("/"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Cancel in the close dialog does nothing and focus goes back to the title", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Close" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fake.raw.closeSession).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/s/a");
  await waitFor(() => expect(document.activeElement).toBe(titleButton()));
});

test("a refused close shows its message in the dialog and keeps it open", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  fake.raw.closeSession.mockRejectedValueOnce(rpcError(-32003, "session not found"));
  await user.click(titleButton());
  await user.click(screen.getByRole("menuitem", { name: "Close" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  expect((await screen.findByRole("alert")).textContent).toBe("session not found");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(location.pathname).toBe("/s/a");
});

const sidebar = () => screen.getByRole("complementary", { name: "Sessions" });
const rowMenu = (name: string) => within(sidebar()).getByRole("button", { name: `Actions for ${name}` });

test("each sidebar row has an actions button in the tab order, with Rename and Close", async () => {
  const user = userEvent.setup();
  await open();
  const button = rowMenu("Other work");
  expect(button.tabIndex).toBe(0);
  await user.click(button);
  expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Rename", "Close"]);
});

test("Rename in the sidebar edits the row's title and saves with Enter", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(rowMenu("Other work"));
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  const field = within(sidebar()).getByRole("textbox", { name: "Rename Other work" }) as HTMLInputElement;
  expect(document.activeElement).toBe(field);
  await user.keyboard("Later work{Enter}");
  expect(fake.raw.renameSession).toHaveBeenCalledWith("b", "Later work");
  await waitFor(() => expect(within(sidebar()).queryByRole("textbox")).toBeNull());
  expect(within(sidebar()).getByRole("link", { name: /Other work/ })).toBeTruthy();
  act(() => {
    fake.emitSummary({ ...summary("b", "2026-11-01T11:59:40Z", CWD), title: "Later work", last_seq: 3 });
  });
  expect(within(sidebar()).getByRole("link", { name: /Later work/ })).toBeTruthy();
});

test("Esc in the sidebar's rename field cancels and focus goes back to the row's button", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(rowMenu("Other work"));
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.keyboard("zzz{Escape}");
  expect(fake.raw.renameSession).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(rowMenu("Other work")));
});

test("Close in the sidebar for another session closes it and stays on the session in view", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(rowMenu("Other work"));
  await user.click(screen.getByRole("menuitem", { name: "Close" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  expect(fake.raw.closeSession).toHaveBeenCalledWith("b");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(location.pathname).toBe("/s/a");
});

test("Cancel in the sidebar's close dialog puts focus back on the row's button", async () => {
  const user = userEvent.setup();
  const { fake } = await open();
  await user.click(rowMenu("Other work"));
  await user.click(screen.getByRole("menuitem", { name: "Close" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.closeSession).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(rowMenu("Other work")));
});

test("Close in the sidebar for the session in view goes to the start page", async () => {
  const user = userEvent.setup();
  await open();
  await user.click(rowMenu("UTF-8 split"));
  await user.click(screen.getByRole("menuitem", { name: "Close" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(location.pathname).toBe("/"));
});

test("a fork is listed under its parent with a mark that names the parent", async () => {
  await open();
  const list = within(sidebar()).getByRole("list");
  const items = within(list).getAllByRole("listitem");
  expect(items.map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "1"]);
  expect(items[1]?.textContent).toContain("fork of UTF-8 split");
  expect(items[1]?.textContent).toContain("⑂");
});

for (const theme of ["slip", "kiln"]) {
  test(`no accessibility violations on the menu, the rename field, the dialog, and the fork tree in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    const user = userEvent.setup();
    const { container } = await open();
    expect((await axe.run(container, noContrast)).violations).toEqual([]);

    await user.click(titleButton());
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    await user.keyboard("{Escape}");

    await user.click(rowMenu("Other work"));
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    await user.click(screen.getByRole("menuitem", { name: "Close" }));
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  });
}
