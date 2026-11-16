import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { ConnectionProvider } from "../../store/connection-context.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { ConnectionStrip } from "../connection/index.ts";
import { closePalette } from "../palette/index.ts";
import { AUTOMATION_ROADMAP, RoutinesInProgress, RunsInProgress, WorkflowsInProgress } from "./in-progress.tsx";
import { PANELS } from "./panels.tsx";
import { SIDEBAR_ITEM_KEY, sidebarItemStore } from "./sidebar-item.ts";
import { SIDEBAR_OPEN_KEY, sidebarOpenStore } from "./sidebar-open.ts";
import { SIDEBAR_DEFAULT, SIDEBAR_WIDTH_KEY, sidebarWidthStore } from "./sidebar-width.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };

function mount(snapshot: ConnectionSnapshot = CONNECTED) {
  const source = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const page = createPage(fakeClient().client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  return render(
    <PageProvider page={page}>
      <ConnectionProvider source={source}>
        <App />
      </ConnectionProvider>
    </PageProvider>,
  );
}

const rail = () => screen.getByRole("navigation", { name: "Sidebar rail" });
const railButton = (name: string) => within(rail()).getByRole("button", { name });
const panel = () => screen.queryByRole("complementary");
const handle = () => screen.getByRole("separator", { name: "Resize sidebar" });

function reset() {
  closePalette();
  localStorage.clear();
  sidebarItemStore.set("sessions");
  sidebarOpenStore.set(null);
  sidebarWidthStore.set(SIDEBAR_DEFAULT);
  history.replaceState(null, "", "/");
}
beforeEach(reset);
afterEach(reset);

test("the rail and the Sessions panel render, with the hide button and the resize handle", async () => {
  const { container } = mount();
  expect(rail()).toBeTruthy();
  expect(panel()?.getAttribute("aria-label")).toBe("Sessions");
  expect(within(panel()!).getByRole("heading", { name: "Sessions" })).toBeTruthy();
  expect(within(panel()!).getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
  expect(handle()).toBeTruthy();
  expect(railButton("Sessions").getAttribute("aria-current")).toBe("true");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});

test("the welcome page has neither the rail nor the panel", () => {
  history.replaceState(null, "", "/welcome");
  mount();
  expect(screen.queryByRole("navigation", { name: "Sidebar rail" })).toBeNull();
  expect(panel()).toBeNull();
});

test("picking an item changes the panel and is kept", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(railButton("Routines"));
  expect(panel()?.getAttribute("aria-label")).toBe("Routines");
  expect(localStorage.getItem(SIDEBAR_ITEM_KEY)).toBe("routines");
  expect(railButton("Routines").getAttribute("aria-current")).toBe("true");
  await user.click(railButton("Inbox"));
  expect(within(panel()!).getByText("Nothing is waiting for you.")).toBeTruthy();
  expect(localStorage.getItem(SIDEBAR_ITEM_KEY)).toBe("inbox");
});

test("a bad stored item gives Sessions, and a good one is read", async () => {
  localStorage.setItem(SIDEBAR_ITEM_KEY, "nope");
  vi.resetModules();
  expect((await import("./sidebar-item.ts")).sidebarItemStore.getSnapshot()).toBe("sessions");
  localStorage.setItem(SIDEBAR_ITEM_KEY, "runs");
  vi.resetModules();
  expect((await import("./sidebar-item.ts")).sidebarItemStore.getSnapshot()).toBe("runs");
});

test("every rail item has a panel in one map", () => {
  expect(Object.keys(PANELS)).toEqual(["sessions", "inbox", "routines", "workflows", "runs"]);
});

test("clicking the picked item hides and shows the panel", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(railButton("Sessions"));
  expect(panel()).toBeNull();
  expect(localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("0");
  await user.click(railButton("Sessions"));
  expect(panel()).not.toBeNull();
  expect(localStorage.getItem(SIDEBAR_OPEN_KEY)).toBe("1");
});

test("picking another item while the panel is hidden shows that panel", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(within(panel()!).getByRole("button", { name: "Hide sidebar" }));
  expect(panel()).toBeNull();
  await user.click(railButton("Runs"));
  expect(panel()?.getAttribute("aria-label")).toBe("Runs");
});

test("the mod key with B hides and shows the panel, also from the message box", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("textbox", { name: "Message" }));
  await user.keyboard("{Control>}b{/Control}");
  expect(panel()).toBeNull();
  await user.keyboard("{Control>}b{/Control}");
  expect(panel()).not.toBeNull();
});

test("a stored width is used", () => {
  sidebarWidthStore.set(20);
  mount();
  expect(panel()!.parentElement!.style.width).toBe("20rem");
  expect(handle().getAttribute("aria-valuenow")).toBe("20");
});

test("the handle's keys resize it, and a double click resets 268 px", async () => {
  const user = userEvent.setup();
  mount();
  handle().focus();
  await user.keyboard("{ArrowRight}");
  expect(handle().getAttribute("aria-valuenow")).toBe(String(SIDEBAR_DEFAULT + 1));
  expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(SIDEBAR_DEFAULT + 1));
  await user.keyboard("{Home}");
  expect(handle().getAttribute("aria-valuenow")).toBe("12.5");
  await user.keyboard("{End}");
  expect(handle().getAttribute("aria-valuenow")).toBe("26.25");
  await user.dblClick(handle());
  expect(handle().getAttribute("aria-valuenow")).toBe(String(SIDEBAR_DEFAULT));
});

test("dragging under 150 px hides the panel", () => {
  mount();
  fireEvent.pointerDown(handle(), { pointerId: 1 });
  fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 100 });
  expect(panel()).toBeNull();
});

test("a reload keeps the open state", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(within(panel()!).getByRole("button", { name: "Hide sidebar" }));
  vi.resetModules();
  expect((await import("./sidebar-open.ts")).sidebarOpenStore.getSnapshot()).toBe(false);
});

test("New session goes home, Settings opens the settings page and is current there, and Search opens the palette", async () => {
  const user = userEvent.setup();
  history.replaceState(null, "", "/settings");
  mount();
  expect(railButton("Settings").getAttribute("aria-current")).toBe("page");
  await user.click(railButton("New session"));
  expect(location.pathname).toBe("/");
  await user.click(railButton("Settings"));
  expect(location.pathname).toBe("/settings");
  await user.click(screen.getByRole("button", { name: /^Search / }));
  expect(await screen.findByRole("dialog", { name: "Commands" })).toBeTruthy();
});

test("the + in the Sessions panel starts a new session", async () => {
  const user = userEvent.setup();
  history.replaceState(null, "", "/settings");
  mount();
  await user.click(within(panel()!).getByRole("button", { name: "Start new session" }));
  expect(location.pathname).toBe("/");
});

test("Routines, Workflows and Runs say they are in progress and link to the roadmap", () => {
  for (const [Panel, name] of [
    [RoutinesInProgress, "Routines"],
    [WorkflowsInProgress, "Workflows"],
    [RunsInProgress, "Runs"],
  ] as const) {
    const { unmount } = render(<Panel />);
    expect(screen.getByText(`${name} are in progress`)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Phase 4 \(#85\)/ }).getAttribute("href")).toBe(AUTOMATION_ROADMAP);
    unmount();
  }
  expect(AUTOMATION_ROADMAP.endsWith("/issues/85")).toBe(true);
});

test("the connection strip: nothing when connected, the wait line while coming back", () => {
  const { container, rerender } = render(<ConnectionStrip snapshot={CONNECTED} />);
  expect(container.textContent).toBe("");
  rerender(<ConnectionStrip snapshot={{ state: { status: "reconnecting", attempt: 1, delayMs: 1000 }, daemonVersion: null }} />);
  expect(screen.getByRole("status").textContent).toBe("Reconnecting to golem…");
  rerender(<ConnectionStrip snapshot={{ state: { status: "connecting" }, daemonVersion: null }} />);
  expect(screen.getByRole("status").textContent).toBe("Reconnecting to golem…");
});

test("the strip shows at the panel's foot when the link is lost after a connect", () => {
  let snapshot: ConnectionSnapshot = CONNECTED;
  const listeners = new Set<() => void>();
  const source = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
  const page = createPage(fakeClient().client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  render(
    <PageProvider page={page}>
      <ConnectionProvider source={source}>
        <App />
      </ConnectionProvider>
    </PageProvider>,
  );
  act(() => {
    snapshot = { state: { status: "reconnecting", attempt: 1, delayMs: 1000 }, daemonVersion: "0.9.1" };
    for (const listener of listeners) listener();
  });
  expect(within(panel()!).getByText("Reconnecting to golem…")).toBeTruthy();
});
