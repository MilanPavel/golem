import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Rail, golemName, type RailProps } from "./rail.tsx";

function setup(props: Partial<RailProps> = {}) {
  const calls = { onPick: vi.fn(), onNew: vi.fn(), onSearch: vi.fn(), onSettings: vi.fn() };
  render(
    <Rail
      state="idle"
      version="0.9.1"
      connected="connected"
      picked={null}
      inboxCount={0}
      settingsDot={false}
      {...calls}
      {...props}
    />,
  );
  return calls;
}

test("the rail is a landmark with the buttons in order", () => {
  setup();
  const nav = screen.getByRole("navigation", { name: "Sidebar rail" });
  const names = within(nav).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  expect(names).toEqual(["New session", "Sessions", "Inbox", "Data", "Routines", "Workflows", "Runs", "Search Ctrl K", "Settings"]);
});

test("the picked item has a bar and aria-current, the others do not", () => {
  setup({ picked: "routines" });
  expect(screen.getByRole("button", { name: "Routines" }).getAttribute("aria-current")).toBe("true");
  expect(screen.getByRole("button", { name: "Sessions" }).hasAttribute("aria-current")).toBe(false);
  expect(screen.getByRole("button", { name: "Routines" }).querySelector(".bg-clay")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Runs" }).querySelector(".bg-clay")).toBeNull();
});

test("the Inbox is named with its count, shows a dot and the count, and caps at 9+", () => {
  setup({ inboxCount: 2 });
  const inbox = screen.getByRole("button", { name: "Inbox, 2 waiting" });
  expect(within(inbox).getByTestId("inbox-count").textContent).toBe("2");
});

test("more than nine waiting shows 9+", () => {
  setup({ inboxCount: 14 });
  expect(within(screen.getByRole("button", { name: "Inbox, 14 waiting" })).getByTestId("inbox-count").textContent).toBe("9+");
});

test("an empty inbox has no dot", () => {
  setup();
  expect(within(screen.getByRole("button", { name: "Inbox" })).queryByTestId("inbox-count")).toBeNull();
});

test("the Settings dot shows only when set", () => {
  setup({ settingsDot: true });
  expect(within(screen.getByRole("button", { name: "Settings" })).queryByTestId("settings-dot")).not.toBeNull();
});

test("no Settings dot by default", () => {
  setup();
  expect(within(screen.getByRole("button", { name: "Settings" })).queryByTestId("settings-dot")).toBeNull();
});

test("each button calls its callback", async () => {
  const user = userEvent.setup();
  const calls = setup();
  await user.click(screen.getByRole("button", { name: "New session" }));
  await user.click(screen.getByRole("button", { name: "Inbox" }));
  await user.click(screen.getByRole("button", { name: "Runs" }));
  await user.click(screen.getByRole("button", { name: /^Search/ }));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(calls.onNew).toHaveBeenCalledOnce();
  expect(calls.onPick.mock.calls).toEqual([["inbox"], ["runs"]]);
  expect(calls.onSearch).toHaveBeenCalledOnce();
  expect(calls.onSearch.mock.calls[0]?.[0]).toBe(screen.getByRole("button", { name: /^Search/ }));
  expect(calls.onSettings).toHaveBeenCalledOnce();
});

test("the golem is named by its version and the connection", () => {
  expect(golemName("0.9.1", "connected")).toBe("golem v0.9.1 · connected");
  expect(golemName("0.9.1", "reconnecting")).toBe("golem v0.9.1 · reconnecting");
  expect(golemName("0.9.1", "offline")).toBe("golem is not running");
  expect(golemName(null, "connected")).toBe("golem · connected");
  expect(golemName(null, "reconnecting")).toBe("golem · reconnecting");
});

test("the golem's accessible name follows the connection", () => {
  setup({ connected: "reconnecting" });
  expect(screen.getByRole("img", { name: "golem v0.9.1 · reconnecting" })).toBeTruthy();
});

test("the golem's tooltip opens on focus", async () => {
  const user = userEvent.setup();
  setup({ connected: "offline" });
  await user.tab();
  expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", "golem is not running");
});

test("a button's tooltip opens on keyboard focus", async () => {
  const user = userEvent.setup();
  setup();
  await user.tab();
  await user.tab();
  expect((await screen.findByRole("tooltip")).textContent).toBe("New session");
});
