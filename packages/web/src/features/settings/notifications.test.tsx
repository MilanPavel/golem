import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { settingsContextStore } from "./index.ts";

type Raw = ReturnType<typeof fakeClient>["raw"];
const VALUES = {
  needs_you: true,
  failed: true,
  finished: false,
  open_in: "web" as const,
  terminal_app: "Terminal",
  terminal_apps: ["Terminal", "iTerm", "Ghostty"],
  finished_routines: ["morning-brief"],
};

function mount(setup: (raw: Raw) => void = () => {}) {
  history.replaceState(null, "", "/settings/notifications");
  const fake = fakeClient();
  fake.raw.getNotifications.mockResolvedValue(VALUES);
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  setup(fake.raw);
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, view, user: userEvent.setup() };
}

afterEach(() => {
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
});

test("the tab shows what tells you, and needs-you is on and cannot be changed", async () => {
  mount();
  const needs = await screen.findByRole("switch", { name: "When something needs me" });
  expect(needs.getAttribute("aria-checked")).toBe("true");
  expect((needs as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("switch", { name: "When a run fails" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("switch", { name: "When a run finishes" }).getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("morning-brief")).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Quiet hours" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Pause all routines" }).hasAttribute("disabled")).toBe(true);
});

test("the toggles write failed and finished", async () => {
  const { fake, user } = mount();
  await user.click(await screen.findByRole("switch", { name: "When a run finishes" }));
  await waitFor(() => expect(fake.raw.setNotifications).toHaveBeenCalledWith({ finished: true }));
  await user.click(screen.getByRole("switch", { name: "When a run fails" }));
  await waitFor(() => expect(fake.raw.setNotifications).toHaveBeenCalledWith({ failed: false }));
});

test("the click target and the terminal app write open_in and terminal_app", async () => {
  const { fake, user } = mount();
  const where = await screen.findByRole("radiogroup", { name: "Open clicks in" });
  expect(where.querySelector("[aria-checked=true]")?.textContent).toBe("Web");
  await user.click(screen.getByRole("radio", { name: "Terminal", checked: false }));
  await waitFor(() => expect(fake.raw.setNotifications).toHaveBeenCalledWith({ open_in: "terminal" }));
  await user.click(screen.getByRole("radio", { name: "Ghostty" }));
  await waitFor(() => expect(fake.raw.setNotifications).toHaveBeenCalledWith({ terminal_app: "Ghostty" }));
});

test("a refused save shows the daemon's message", async () => {
  const { user } = mount((raw) => raw.setNotifications.mockResolvedValue({ ok: false, errors: [{ message: "terminal_app: not a terminal" }] }));
  await user.click(await screen.findByRole("switch", { name: "When a run finishes" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not a terminal");
});

test("Send a test calls notify.test and says what happened", async () => {
  const { fake, user } = mount();
  await user.click(await screen.findByRole("button", { name: "Send a test" }));
  await waitFor(() => expect(fake.raw.notifyTest).toHaveBeenCalledTimes(1));
  expect((await screen.findByRole("status")).textContent).toContain("Sent");
  fake.raw.notifyTest.mockResolvedValue({ posted: false, mechanism: "none" });
  await user.click(screen.getByRole("button", { name: "Send a test" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Nothing was shown"));
});

test("the tab has no accessibility violations", async () => {
  const { view } = mount();
  await screen.findByRole("switch", { name: "When a run fails" });
  const result = await axe.run(view.container);
  expect(result.violations).toEqual([]);
});
