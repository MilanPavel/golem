import { focusManager } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createAppInstall } from "../../store/app-install.ts";
import { createPageHost } from "../../store/page-host.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { OK_ROWS, STATUS_ROWS, WORKING_LISTING } from "../setup/sample.ts";
import { settingsContextStore, useSettingsFolder } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const PROBLEM = "Ollama: Ollama is not installed";

function mount(path: string, rows: typeof OK_ROWS | "fail" = OK_ROWS, extra: { kept?: boolean; appInstall?: ReturnType<typeof createAppInstall> } = {}) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  if (rows === "fail") fake.raw.setupStatus.mockRejectedValue(new Error("no status"));
  else fake.raw.setupStatus.mockResolvedValue({ rows });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, {
    frame: fakeFrame(),
    doc,
    ...(extra.kept === undefined ? {} : { pageHost: createPageHost(async () => ({ kept: extra.kept })) }),
    ...(extra.appInstall === undefined ? {} : { appInstall: extra.appInstall }),
  });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, user: userEvent.setup(), ...view };
}

const sidebar = () => screen.getByRole("complementary", { name: "Sessions" });
const settingsButton = (name: string | RegExp = /^Settings/) => within(sidebar()).getByRole("button", { name });

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

// The sidebar button

test("the Settings button has a gear, no dot, and the plain name when the setup is fine", async () => {
  const { fake } = mount("/", OK_ROWS);
  await waitFor(() => expect(fake.raw.setupStatus).toHaveBeenCalled());
  const button = settingsButton("Settings");
  expect(button.querySelector("svg")).not.toBeNull();
  expect(button.querySelector(".bg-wait")).toBeNull();
  expect(button.getAttribute("aria-current")).toBeNull();
});

test("with a setup problem the button shows a dot and the problem, in its name and its title", async () => {
  mount("/", STATUS_ROWS);
  const button = await screen.findByRole("button", { name: `Settings, ${PROBLEM}` });
  expect(button.querySelector(".bg-wait")).not.toBeNull();
  expect(button.querySelector("[title]")?.getAttribute("title")).toBe(PROBLEM);
  expect(within(button).getAllByText(PROBLEM).length).toBeGreaterThan(0);
});

test("a failed setup.status leaves the plain button", async () => {
  const { fake } = mount("/", "fail");
  await waitFor(() => expect(fake.raw.setupStatus).toHaveBeenCalled());
  const button = settingsButton("Settings");
  expect(button.querySelector(".bg-wait")).toBeNull();
});

test("a click opens /settings without a page load, and the button is current there", async () => {
  const { user } = mount("/", OK_ROWS);
  await user.click(settingsButton("Settings"));
  expect(location.pathname).toBe("/settings");
  expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
  expect(settingsButton("Settings").getAttribute("aria-current")).toBe("page");
});

// The screen

test("the section list marks the current section, and a link moves between them", async () => {
  const { user } = mount("/settings", OK_ROWS);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(within(nav).getByRole("link", { name: "Setup" }).getAttribute("aria-current")).toBe("page");
  expect(within(nav).getByRole("link", { name: "Appearance" }).getAttribute("aria-current")).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "Setup" })).toBeTruthy();
  await user.click(within(nav).getByRole("link", { name: "Appearance" }));
  expect(location.pathname).toBe("/settings/appearance");
  expect(within(nav).getByRole("link", { name: "Appearance" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
});

test("a section the page does not list says so, with a way back", async () => {
  const { user } = mount("/settings/nothing", OK_ROWS);
  expect(screen.getByText("There is no such section.")).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Go to Settings" }));
  expect(location.pathname).toBe("/settings");
  expect(screen.getByRole("heading", { level: 2, name: "Setup" })).toBeTruthy();
});

test("the Setup section says the problem in a status line, and all set once it is fixed", async () => {
  const { fake } = mount("/settings", STATUS_ROWS);
  expect(await screen.findByText(PROBLEM, { selector: "p" })).toBeTruthy();
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(await screen.findByText("All set", { selector: "p" })).toBeTruthy();
});

test("the Setup section reads all set when nothing is wrong", async () => {
  mount("/settings", OK_ROWS);
  expect(await screen.findByText("All set", { selector: "p" })).toBeTruthy();
});

test("Appearance offers Match system, Light and Dark, and the sidebar has no theme switch", async () => {
  const { user } = mount("/settings/appearance", OK_ROWS);
  const main = screen.getByRole("main");
  expect(within(sidebar()).queryByRole("group", { name: "Theme" })).toBeNull();
  expect(within(main).getByRole("button", { name: "Match system" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(within(main).getByRole("button", { name: "Dark" }));
  expect(document.documentElement.dataset.theme).toBe("kiln");
  expect(within(main).getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(within(main).getByRole("button", { name: "Light" }));
  expect(document.documentElement.dataset.theme).toBe("slip");
  await user.click(within(main).getByRole("button", { name: "Match system" }));
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test("Appearance has an App block with the install action when the web job keeps the page", async () => {
  const listeners = new Map<string, (event: Event) => void>();
  const appInstall = createAppInstall({
    addEventListener: (type, listener) => listeners.set(type, listener),
    navigator: { userAgent: "Mozilla/5.0 (Macintosh) Chrome/126.0 Safari/537.36" },
  });
  const prompt = vi.fn(async () => undefined);
  const { user } = mount("/settings/appearance", OK_ROWS, { kept: true, appInstall });
  const main = screen.getByRole("main");
  expect(await within(main).findByRole("heading", { level: 3, name: "App" })).toBeTruthy();
  expect(within(main).queryByRole("button", { name: "Install golem as an app" })).toBeNull();
  act(() => {
    listeners.get("beforeinstallprompt")?.(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt }));
  });
  await user.click(await within(main).findByRole("button", { name: "Install golem as an app" }));
  expect(prompt).toHaveBeenCalledTimes(1);
});

test("Appearance shows the App block even while the web job is not installed", async () => {
  mount("/settings/appearance", OK_ROWS, { kept: false });
  await screen.findByRole("button", { name: "Dark" });
  expect(await screen.findByRole("heading", { level: 3, name: "App" })).toBeTruthy();
});

// Looking again

test("setup.status is read again when Settings opens, and when the tab is seen again", async () => {
  const { fake, user } = mount("/", OK_ROWS);
  await waitFor(() => expect(fake.raw.setupStatus).toHaveBeenCalledTimes(1));
  await user.click(settingsButton("Settings"));
  await waitFor(() => expect(fake.raw.setupStatus.mock.calls.length).toBeGreaterThan(1));
  const before = fake.raw.setupStatus.mock.calls.length;
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(fake.raw.setupStatus.mock.calls.length).toBeGreaterThan(before));
});

// The palette

test("the palette has a Settings row in the View group, and it opens the page", async () => {
  const { user } = mount("/", OK_ROWS);
  await user.click(within(sidebar()).getByRole("button", { name: /Search or run a command/ }));
  const palette = await screen.findByRole("dialog", { name: "Commands" });
  const row = within(palette).getByRole("option", { name: /^Settings/ });
  const group = row.closest("[role=group]");
  expect(group?.getAttribute("aria-labelledby")).toBeTruthy();
  expect(document.getElementById(group?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("View");
  await user.type(within(palette).getByRole("combobox", { name: "Search commands" }), "settings{Enter}");
  await waitFor(() => expect(location.pathname).toBe("/settings"));
});

// The context of a session

test("a session screen remembers its folder for Settings, and the folder hook prefers it", async () => {
  const { fake, user } = mount("/", OK_ROWS);
  act(() => {
    fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"));
  });
  await user.click(await screen.findByRole("link", { name: /Untitled/ }));
  await waitFor(() => expect(settingsContextStore.getSnapshot()).toEqual({ sessionId: "a", cwd: "/Users/you/repos/golem" }));
  await user.click(settingsButton("Settings"));
  expect(settingsContextStore.getSnapshot()?.sessionId).toBe("a");
});

function Folder() {
  return <p data-testid="folder">{useSettingsFolder() ?? "none"}</p>;
}

function folderPage(list: ReturnType<typeof summary>[]) {
  const fake = fakeClient();
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  act(() => {
    for (const item of list) fake.emitSummary(item);
  });
  render(
    <PageProvider page={page}>
      <Folder />
    </PageProvider>,
  );
}

test("useSettingsFolder: the context's folder, else the new session's, else none", () => {
  folderPage([]);
  expect(screen.getByTestId("folder").textContent).toBe("none");
  act(() => settingsContextStore.set({ sessionId: "a", cwd: "/work/one" }));
  expect(screen.getByTestId("folder").textContent).toBe("/work/one");
  act(() => settingsContextStore.set({ sessionId: "a", cwd: null }));
  expect(screen.getByTestId("folder").textContent).toBe("none");
});

test("useSettingsFolder falls back to the new session's folder when the context has none", () => {
  folderPage([summary("b", "2026-11-01T10:00:00Z", "/work/two")]);
  expect(screen.getByTestId("folder").textContent).toBe("/work/two");
  act(() => settingsContextStore.set({ sessionId: "a", cwd: null }));
  expect(screen.getByTestId("folder").textContent).toBe("/work/two");
  act(() => settingsContextStore.set({ sessionId: "a", cwd: "/work/one" }));
  expect(screen.getByTestId("folder").textContent).toBe("/work/one");
});

test("Close settings goes back to the session the person came from, else home", async () => {
  const first = mount("/settings", OK_ROWS);
  await first.user.click(await screen.findByRole("button", { name: "Close settings" }));
  expect(location.pathname).toBe("/");
  first.unmount();

  settingsContextStore.set({ sessionId: "a", cwd: null });
  const second = mount("/settings/appearance", OK_ROWS);
  await second.user.click(await screen.findByRole("button", { name: "Close settings" }));
  expect(location.pathname).toBe("/s/a");
});

// Accessibility

for (const theme of ["slip", "kiln"] as const) {
  test(`no accessibility violations on the Settings screens and on the sidebar with a problem in ${theme}`, async () => {
    const { container, user } = mount("/settings", STATUS_ROWS);
    document.documentElement.dataset.theme = theme;
    await screen.findByRole("button", { name: `Settings, ${PROBLEM}` });
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("link", { name: "Appearance" }));
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  });
}
