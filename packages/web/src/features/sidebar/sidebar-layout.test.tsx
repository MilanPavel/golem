import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { ConnectionProvider } from "../../store/connection-context.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { layoutMode } from "./layout-mode.ts";
import { sidebarItemStore } from "./sidebar-item.ts";
import { SIDEBAR_OPEN_KEY, sidebarOpenStore } from "./sidebar-open.ts";
import { sidebarOverlayStore } from "./sidebar-overlay.ts";
import { SIDEBAR_DEFAULT, sidebarWidthStore } from "./sidebar-width.ts";

const CONNECTED: ConnectionSnapshot = { state: { status: "connected" }, daemonVersion: "0.9.1" };
const REM = 16;

/** A matchMedia that answers `(min-width: Nrem)` for a window of the given width, and can change it later. */
function windowWidth(initial: number) {
  let px = initial;
  const lists = new Set<{ query: string; listeners: Set<() => void> }>();
  const matches = (query: string) => {
    const rem = /min-width:\s*([\d.]+)rem/.exec(query);
    return rem !== null && px >= Number(rem[1]) * REM;
  };
  vi.stubGlobal("matchMedia", (query: string) => {
    const entry = { query, listeners: new Set<() => void>() };
    lists.add(entry);
    return {
      get matches() {
        return matches(query);
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => entry.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => entry.listeners.delete(listener),
    };
  });
  return (next: number) => {
    px = next;
    act(() => {
      for (const entry of lists) for (const listener of entry.listeners) listener();
    });
  };
}

function mount() {
  const source = { subscribe: () => () => {}, getSnapshot: () => CONNECTED };
  const page = createPage(fakeClient().client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  return render(
    <PageProvider page={page}>
      <ConnectionProvider source={source}>
        <App />
      </ConnectionProvider>
    </PageProvider>,
  );
}

const rail = () => screen.queryByRole("navigation", { name: "Sidebar rail" });
const panel = () => screen.queryByRole("complementary");
const scrim = () => screen.queryByTestId("sidebar-scrim");
const menu = () => screen.queryByRole("button", { name: "Open sidebar" });

function reset() {
  closePalette();
  vi.unstubAllGlobals();
  localStorage.clear();
  sidebarItemStore.set("sessions");
  sidebarOpenStore.set(null);
  sidebarOverlayStore.set(false);
  sidebarWidthStore.set(SIDEBAR_DEFAULT);
  history.replaceState(null, "", "/");
}
beforeEach(reset);
afterEach(reset);

test("layoutMode picks wide from 1100 px, narrow below 760 px", () => {
  expect(layoutMode(true, true)).toBe("wide");
  expect(layoutMode(false, true)).toBe("medium");
  expect(layoutMode(false, false)).toBe("narrow");
});

test("wide: rail and panel sit side by side, with no scrim and no menu button", () => {
  windowWidth(1280);
  mount();
  expect(rail()).toBeTruthy();
  expect(panel()).toBeTruthy();
  expect(scrim()).toBeNull();
  expect(menu()).toBeNull();
});

test("medium: the rail shows and the panel is hidden, even when wide left it open", () => {
  windowWidth(900);
  localStorage.setItem(SIDEBAR_OPEN_KEY, "1");
  sidebarOpenStore.set(true);
  mount();
  expect(rail()).toBeTruthy();
  expect(panel()).toBeNull();
  expect(menu()).toBeNull();
});

test("medium: a rail icon floats the panel over the page with a scrim; the scrim, Esc, and picking close it", async () => {
  const user = userEvent.setup();
  windowWidth(900);
  mount();
  await user.click(within(rail()!).getByRole("button", { name: "Sessions" }));
  expect(panel()).toBeTruthy();
  expect(scrim()).toBeTruthy();
  // The wide layout's stored state is not touched.
  expect(localStorage.getItem(SIDEBAR_OPEN_KEY)).toBeNull();

  await user.click(scrim()!);
  expect(panel()).toBeNull();

  await user.click(within(rail()!).getByRole("button", { name: "Sessions" }));
  await user.keyboard("{Escape}");
  expect(panel()).toBeNull();

  await user.keyboard("{Control>}b{/Control}");
  expect(panel()).toBeTruthy();
  await user.click(within(rail()!).getByRole("button", { name: "Settings" }));
  expect(panel()).toBeNull();
  expect(scrim()).toBeNull();
});

test("medium: closing by Esc, the scrim, or the hide button returns focus to what opened the panel", async () => {
  const user = userEvent.setup();
  windowWidth(900);
  mount();
  const icon = () => within(rail()!).getByRole("button", { name: "Sessions" });
  await user.click(icon());
  expect(document.activeElement).not.toBe(icon());
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(icon());

  await user.click(icon());
  await user.click(scrim()!);
  expect(document.activeElement).toBe(icon());

  await user.click(icon());
  await user.click(within(panel()!).getByRole("button", { name: "Hide sidebar" }));
  expect(document.activeElement).toBe(icon());
});

test("narrow: no rail, a menu button opens rail and panel together, and Esc closes them and returns focus", async () => {
  const user = userEvent.setup();
  windowWidth(500);
  mount();
  expect(rail()).toBeNull();
  expect(panel()).toBeNull();
  const button = menu()!;
  expect(button).toBeTruthy();

  await user.click(button);
  const dialog = screen.getByRole("dialog", { name: "Sidebar" });
  expect(within(dialog).getByRole("navigation", { name: "Sidebar rail" })).toBeTruthy();
  expect(within(dialog).getByRole("complementary")).toBeTruthy();
  expect(scrim()).toBeTruthy();
  expect(document.activeElement).toBe(dialog);

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(rail()).toBeNull();
  expect(document.activeElement).toBe(menu());
});

test("narrow: picking a rail item keeps the panel, picking a page closes both, the scrim closes both", async () => {
  const user = userEvent.setup();
  windowWidth(500);
  mount();
  await user.click(menu()!);
  await user.click(within(rail()!).getByRole("button", { name: "Routines" }));
  expect(panel()?.getAttribute("aria-label")).toBe("Routines");
  // Clicking the picked item does not hide the panel here.
  await user.click(within(rail()!).getByRole("button", { name: "Routines" }));
  expect(panel()).toBeTruthy();

  await user.click(within(rail()!).getByRole("button", { name: "Settings" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  await user.click(menu()!);
  await user.click(scrim()!);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a window that grows wide closes the floating panel and shows the stored layout", async () => {
  const user = userEvent.setup();
  const resize = windowWidth(500);
  mount();
  await user.click(menu()!);
  resize(1280);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(rail()).toBeTruthy();
  expect(panel()).toBeTruthy();
  expect(scrim()).toBeNull();
  resize(900);
  expect(panel()).toBeNull();
});

test("medium on Settings: the rail floats the panel as it does elsewhere", async () => {
  windowWidth(900);
  history.replaceState(null, "", "/settings");
  const user = userEvent.setup();
  mount();
  expect(panel()).toBeNull();
  await user.click(within(rail()!).getByRole("button", { name: "Sessions" }));
  expect(panel()).not.toBeNull();
  expect(scrim()).not.toBeNull();
});
