import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { sidebarItemStore } from "./sidebar-item.ts";
import { sidebarOpenStore } from "./sidebar-open.ts";
import { SIDEBAR_DEFAULT, sidebarWidthStore } from "./sidebar-width.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

function mount() {
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
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"), title: "UTF-8 split" });
    fake.emitSummary({ ...summary("b", "2026-11-01T10:00:00Z", "/Users/you/notes"), title: "PR digest" });
  });
  return view;
}

const icon = () => within(screen.getByRole("navigation", { name: "Sidebar rail" })).getByRole("button", { name: "Sessions" });
const flyout = () => screen.queryByRole("dialog", { name: "Sessions" });

function reset() {
  localStorage.clear();
  sidebarItemStore.set("sessions");
  sidebarOpenStore.set(null);
  sidebarWidthStore.set(SIDEBAR_DEFAULT);
  history.replaceState(null, "", "/");
}
beforeEach(() => {
  reset();
  sidebarOpenStore.set(false);
});
afterEach(reset);

test("hovering the Sessions icon opens the flyout with the list, and the icon says so", async () => {
  const user = userEvent.setup();
  const { container } = mount();
  expect(flyout()).toBeNull();
  expect(icon().getAttribute("aria-expanded")).toBe("false");
  await user.hover(icon());
  const box = await screen.findByRole("dialog", { name: "Sessions" });
  expect(within(box).getByRole("link", { name: /PR digest/ })).toBeTruthy();
  expect(icon().getAttribute("aria-expanded")).toBe("true");
  expect(icon().getAttribute("aria-controls")).toBe(box.id);
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  expect((await axe.run(box, noContrast)).violations).toEqual([]);
});

test("keyboard focus on the icon opens it, and Tab goes into the list", async () => {
  const user = userEvent.setup();
  mount();
  act(() => icon().focus());
  const box = await screen.findByRole("dialog", { name: "Sessions" });
  await user.tab();
  expect(box.contains(document.activeElement)).toBe(true);
});

test("Esc closes it and gives focus back to the icon, without opening it again", async () => {
  const user = userEvent.setup();
  mount();
  act(() => icon().focus());
  const box = await screen.findByRole("dialog", { name: "Sessions" });
  await user.tab();
  expect(box.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(flyout()).toBeNull());
  expect(document.activeElement).toBe(icon());
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(flyout()).toBeNull();
});

test("it stays open while the pointer is in it, and closes after the pointer leaves", async () => {
  const user = userEvent.setup();
  mount();
  await user.hover(icon());
  const box = await screen.findByRole("dialog", { name: "Sessions" });
  await user.hover(box);
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(flyout()).toBeTruthy();
  await user.unhover(box);
  await waitFor(() => expect(flyout()).toBeNull());
});

test("picking a session goes to it and closes the flyout", async () => {
  const user = userEvent.setup();
  mount();
  await user.hover(icon());
  const box = await screen.findByRole("dialog", { name: "Sessions" });
  await user.click(within(box).getByRole("link", { name: /PR digest/ }));
  expect(location.pathname).toBe("/s/b");
  await waitFor(() => expect(flyout()).toBeNull());
});

test("clicking the icon opens the panel and the flyout is gone", async () => {
  const user = userEvent.setup();
  mount();
  await user.hover(icon());
  await screen.findByRole("dialog", { name: "Sessions" });
  await user.click(icon());
  await waitFor(() => expect(flyout()).toBeNull());
  expect(screen.getByRole("complementary", { name: "Sessions" })).toBeTruthy();
});

test("with the panel shown the flyout does not open", async () => {
  sidebarOpenStore.set(true);
  const user = userEvent.setup();
  mount();
  await user.hover(icon());
  act(() => icon().focus());
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(flyout()).toBeNull();
});

test("Tab past the last item closes it and goes to Inbox; Shift+Tab from the first goes back to the icon", async () => {
  const user = userEvent.setup();
  mount();
  act(() => icon().focus());
  const box = await screen.findByRole("dialog", { name: "Sessions" });
  await user.tab();
  const items = Array.from(box.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(icon());
  act(() => items[items.length - 1]!.focus());
  await user.tab();
  await waitFor(() => expect(flyout()).toBeNull());
  expect(document.activeElement).toBe(within(screen.getByRole("navigation", { name: "Sidebar rail" })).getByRole("button", { name: "Inbox" }));
});

test("the icon shows no tooltip while the flyout is open", async () => {
  const user = userEvent.setup();
  mount();
  await user.hover(icon());
  await screen.findByRole("dialog", { name: "Sessions" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
