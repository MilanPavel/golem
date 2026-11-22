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
import { GROUPS, SECTIONS } from "./sections.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

function mount(path: string, rows: typeof OK_ROWS | "fail" = OK_ROWS, extra: { kept?: boolean; appInstall?: ReturnType<typeof createAppInstall>; servers?: unknown[] } = {}) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  if (extra.servers !== undefined) fake.raw.listMcp.mockResolvedValue({ servers: extra.servers } as never);
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

const rail = () => screen.getByRole("navigation", { name: "Sidebar rail" });
const settingsButton = (name: string | RegExp = /^Settings/) => within(rail()).getByRole("button", { name });

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
  expect(screen.queryByTestId("settings-dot")).toBeNull();
  expect(button.getAttribute("aria-current")).toBeNull();
});

test("with a setup problem the button shows a dot", async () => {
  mount("/", STATUS_ROWS);
  const dot = await screen.findByTestId("settings-dot");
  expect(settingsButton("Settings").contains(dot)).toBe(true);
});

test("a failed setup.status leaves the plain button", async () => {
  const { fake } = mount("/", "fail");
  await waitFor(() => expect(fake.raw.setupStatus).toHaveBeenCalled());
  expect(screen.queryByTestId("settings-dot")).toBeNull();
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
  expect(within(nav).getByRole("link", { name: "Info" }).getAttribute("aria-current")).toBe("page");
  expect(within(nav).getByRole("link", { name: "Appearance" }).getAttribute("aria-current")).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "Info" })).toBeTruthy();
  await user.click(within(nav).getByRole("link", { name: "Appearance" }));
  expect(location.pathname).toBe("/settings/appearance");
  expect(within(nav).getByRole("link", { name: "Appearance" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
});

test("every section appears once in the sidebar, under its group, in order", () => {
  mount("/settings", OK_ROWS);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  const links = within(nav).getAllByRole("link");
  const expected = GROUPS.flatMap((group) => SECTIONS.filter((item) => item.group === group.id).map((item) => item.title));
  expect(expected).toHaveLength(SECTIONS.length);
  expect(links.map((link) => link.textContent.trim())).toEqual(["Info", "Chat", "Appearance", "Notifications", "Models", "Routing", "Context", "Usage", "MCP servers", "Skills", "Agents", "Memory", "Devices", "Tool rules", "Config file"]);
  expect(links.map((link) => link.textContent.trim())).toEqual(expected);
  const headings = Array.from(nav.querySelectorAll("div > span")).map((node) => node.textContent);
  expect(headings).toEqual(GROUPS.map((group) => group.title));
});

test("no group label is uppercase, and the page head has no group eyebrow", () => {
  mount("/settings/routing", OK_ROWS);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  for (const node of nav.querySelectorAll("div > span")) {
    expect(node.className).not.toMatch(/uppercase|tracking-(wide|widest)|font-mono/);
  }
  const head = screen.getByRole("heading", { level: 2, name: "Routing" }).parentElement as HTMLElement;
  expect(head.querySelector("span")).toBeNull();
  expect(within(head).queryByText("Models")).toBeNull();
  expect(within(head).getByText(SECTIONS.find((item) => item.id === "routing")?.description ?? "")).toBeTruthy();
});

test("/settings/setup lands on Info, and the address follows", async () => {
  mount("/settings/setup", OK_ROWS);
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(within(nav).getByRole("link", { name: "Info" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("heading", { level: 2, name: "Info" })).toBeTruthy();
  await waitFor(() => expect(location.pathname).toBe("/settings"));
});

test("the narrow picker shows the current section and lists every group", async () => {
  const { user } = mount("/settings/usage", OK_ROWS);
  const picker = screen.getByRole("button", { name: /Usage/ });
  expect(picker.getAttribute("aria-expanded")).toBe("false");
  await user.click(picker);
  const list = screen.getByRole("group", { name: "All settings sections" });
  for (const group of GROUPS) expect(within(list).getAllByText(group.title).length).toBeGreaterThan(0);
  expect(within(list).getAllByRole("link")).toHaveLength(SECTIONS.length);
  expect(within(list).getByRole("link", { name: "Usage" }).getAttribute("aria-current")).toBe("page");
  await user.click(within(list).getByRole("link", { name: "Skills" }));
  expect(location.pathname).toBe("/settings/skills");
  expect(screen.queryByRole("group", { name: "All settings sections" })).toBeNull();
});

test("a section the page does not list says so, with a way back", async () => {
  const { user } = mount("/settings/nothing", OK_ROWS);
  expect(screen.getByText("There is no such section.")).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Go to Settings" }));
  expect(location.pathname).toBe("/settings");
  expect(screen.getByRole("heading", { level: 2, name: "Info" })).toBeTruthy();
});

test("the Health list counts what needs fixing, and counts again once it is fixed", async () => {
  const { fake } = mount("/settings", STATUS_ROWS);
  expect(await screen.findByText("2 to fix · 3 fine")).toBeTruthy();
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(await screen.findByText("0 to fix · 5 fine")).toBeTruthy();
});

test("Appearance offers Match system, Light and Dark, and the sidebar has no theme switch", async () => {
  const { user } = mount("/settings/appearance", OK_ROWS);
  const main = screen.getByRole("main");
  expect(within(rail()).queryByRole("group", { name: "Theme" })).toBeNull();
  expect(within(main).getByRole("button", { name: "Match system" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(within(main).getByRole("button", { name: "Dark" }));
  expect(document.documentElement.dataset.theme).toBe("kiln");
  expect(within(main).getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(within(main).getByRole("button", { name: "Light" }));
  expect(document.documentElement.dataset.theme).toBe("slip");
  await user.click(within(main).getByRole("button", { name: "Match system" }));
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test("Appearance no longer has the chat detail row, and a line there links to Chat", async () => {
  const { user } = mount("/settings/appearance", OK_ROWS);
  const main = screen.getByRole("main");
  expect(within(main).queryByRole("radiogroup", { name: "Chat detail" })).toBeNull();
  await user.click(within(main).getByRole("link", { name: "How much a chat shows moved to Chat." }));
  expect(location.pathname).toBe("/settings/chat");
  expect(screen.getByRole("heading", { level: 2, name: "Chat" })).toBeTruthy();
  expect(screen.getByRole("radiogroup", { name: "Steps" })).toBeTruthy();
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
  await user.click(within(rail()).getByRole("button", { name: /^Search/ }));
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

test("Back names where it goes, and goes there; there is no Close settings", async () => {
  const first = mount("/settings", OK_ROWS);
  expect(screen.queryByRole("button", { name: "Close settings" })).toBeNull();
  // The list and the picker each have one; CSS shows one of them.
  const [chats] = await screen.findAllByRole("button", { name: "Back to chats" });
  expect(within(chats!).getByText("Chats")).toBeTruthy();
  await first.user.click(chats!);
  expect(location.pathname).toBe("/");
  first.unmount();

  settingsContextStore.set({ sessionId: "a", cwd: null });
  const second = mount("/settings/appearance", OK_ROWS);
  act(() => {
    second.fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z"), title: "Fix the build" });
  });
  const [back] = await screen.findAllByRole("button", { name: "Back to Fix the build" });
  expect(within(back!).getByText("Fix the build")).toBeTruthy();
  await second.user.click(screen.getByRole("link", { name: /Routing/ }));
  expect(screen.getAllByRole("button", { name: "Back to Fix the build" })).toHaveLength(2);
  await second.user.click(screen.getAllByRole("button", { name: "Back to Fix the build" })[0]!);
  expect(location.pathname).toBe("/s/a");
});

test("Esc on the page goes back, Esc in a field does not", async () => {
  const { user } = mount("/settings/appearance", OK_ROWS);
  const box = await screen.findByRole("textbox", { name: "Search settings" });
  await user.click(box);
  await user.keyboard("{Escape}");
  expect(location.pathname).toBe("/settings/appearance");
  box.blur();
  await user.keyboard("{Escape}");
  expect(location.pathname).toBe("/");
});

test("Esc goes back with focus outside the page, as on the rail's gear after a click", async () => {
  const { user } = mount("/settings/appearance", OK_ROWS);
  await screen.findByRole("textbox", { name: "Search settings" });
  const gear = document.createElement("button");
  gear.textContent = "Settings";
  document.body.append(gear);
  try {
    gear.focus();
    await user.keyboard("{Escape}");
    expect(location.pathname).toBe("/");
  } finally {
    gear.remove();
  }
});

// Accessibility

for (const theme of ["slip", "kiln"] as const) {
  test(`no accessibility violations on the Settings screens and on the sidebar with a problem in ${theme}`, async () => {
    const { container, user } = mount("/settings", STATUS_ROWS);
    document.documentElement.dataset.theme = theme;
    await screen.findByTestId("settings-dot");
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("link", { name: "Appearance" }));
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  });
}

const nav = () => screen.getByTestId("settings-nav");

test("a badge shows the count of checks to fix next to Info, and goes away once they are fixed", async () => {
  const { fake } = mount("/settings/appearance", STATUS_ROWS);
  const badge = await within(nav()).findByTitle("2 to fix");
  expect(badge.textContent).toBe("2");
  expect(within(nav()).getByRole("link", { name: /^Info/ }).contains(badge)).toBe(true);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(within(nav()).queryByTitle(/to fix/)).toBeNull());
});

test("nothing is rendered for a section with 0 to fix", async () => {
  const { fake } = mount("/settings/appearance", OK_ROWS);
  await waitFor(() => expect(fake.raw.setupStatus).toHaveBeenCalled());
  expect(within(nav()).queryByTitle(/to fix/)).toBeNull();
});

test("a server that failed to start badges MCP servers, and the narrow picker button shows the sum", async () => {
  const server = { name: "git", state: "failed", error: "exited", tools: [], config: "/c.json" };
  mount("/settings/appearance", STATUS_ROWS, { servers: [server] });
  const link = within(nav()).getByRole("link", { name: /^MCP servers/ });
  await waitFor(() => expect(within(link).getByTitle("1 to fix")).toBeTruthy());
  const button = screen.getByRole("button", { name: /Appearance/ });
  expect(within(button).getByTitle("3 to fix").textContent).toBe("3");
});
