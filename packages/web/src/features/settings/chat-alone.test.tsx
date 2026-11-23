import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { settingsContextStore } from "./index.ts";
import { searchSettings } from "./settings-search.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

function mount(path: string, chat: { plan_first: boolean; mode: "careful" | "balanced" | "autopilot" } = { plan_first: false, mode: "balanced" }) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.getChat.mockResolvedValue({ instructions: [], ...chat });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  act(() => {
    fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"));
  });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, user: userEvent.setup(), ...view };
}

const modes = () => screen.findByRole("radiogroup", { name: "Mode" });

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
});

const zones = (group: HTMLElement) => [...group.querySelectorAll<HTMLElement>("[data-zone]")];
const states = (group: HTMLElement) => zones(group).map((zone) => zone.getAttribute("data-zone"));

test("the track shows the mode from the daemon, as three stops and four zones, and no code wording", async () => {
  mount("/settings/chat", { plan_first: false, mode: "autopilot" });
  const group = await modes();
  const radios = within(group).getAllByRole("radio");
  expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  expect(states(group)).toEqual(["alone", "alone", "alone", "lock"]);
  const text = screen.getByRole("list", { name: "How far it goes alone" }).textContent ?? "";
  for (const word of ["Careful", "Balanced", "Autopilot", "Read files", "Look things up", "Change files, run commands", "Outside the folder", "also the unsandboxed shell and MCP tools", "Start with a plan"]) expect(text).toContain(word);
  expect(text).not.toMatch(/\b(git|commits?|code|repos?)\b/i);
});

test("with Balanced the first two zones say alone, the third asks you, the last always asks", async () => {
  mount("/settings/chat");
  const group = await modes();
  expect(zones(group).map((zone) => zone.querySelector("em")?.textContent)).toEqual(["alone", "alone", "asks you", "always asks"]);
  expect(screen.getByText("Balanced.").parentElement?.textContent).toContain("Reads and looks things up on the web alone.");
});

test("the fine print links tool rules and has no separate always-ask sentence", async () => {
  mount("/settings/chat");
  await modes();
  const list = screen.getByRole("list", { name: "How far it goes alone" });
  expect(within(list).getByRole("link", { name: "tool rules" }).getAttribute("href")).toBe("/settings/rules");
  expect(list.textContent).toContain("A chat can use another mode: pick it in the composer.");
  expect(list.textContent).not.toContain("Files outside the folder always ask");
});

test("the arrow keys move the choice, and Autopilot still asks first", async () => {
  const { fake, user } = mount("/settings/chat");
  fake.raw.setDefaultPermissionMode.mockResolvedValue({ mode: "careful", path: "/Users/you/.golem/config.toml" });
  const group = await modes();
  within(group).getByRole("radio", { name: /Balanced/ }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(fake.raw.setDefaultPermissionMode).toHaveBeenCalledWith("careful");
  expect(document.activeElement).toBe(within(group).getByRole("radio", { name: /Careful/ }));
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(within(group).getByRole("radio", { name: /Autopilot/ }));
  expect(screen.getByRole("group", { name: "Use Autopilot?" })).toBeTruthy();
});

test("choosing Careful saves it through permissions.set_mode", async () => {
  const { fake, user } = mount("/settings/chat");
  fake.raw.setDefaultPermissionMode.mockResolvedValue({ mode: "careful", path: "/Users/you/.golem/config.toml" });
  fake.raw.getChat.mockResolvedValue({ instructions: [], plan_first: false, mode: "careful" });
  await user.click(within(await modes()).getByRole("radio", { name: /Careful/ }));
  expect(fake.raw.setDefaultPermissionMode).toHaveBeenCalledWith("careful");
  expect(await screen.findByText("Saved to /Users/you/.golem/config.toml")).toBeTruthy();
  await waitFor(() => expect(states(screen.getByRole("radiogroup", { name: "Mode" }))).toEqual(["alone", "asks", "asks", "lock"]));
});

test("Autopilot asks in place first, and Cancel sends nothing", async () => {
  const { fake, user } = mount("/settings/chat");
  const group = await modes();
  await user.click(within(group).getByRole("radio", { name: /Autopilot/ }));
  const ask = screen.getByRole("group", { name: "Use Autopilot?" });
  expect(ask.textContent).toContain("Autopilot runs commands and changes files without asking. Use it for chats you watch.");
  expect(fake.raw.setDefaultPermissionMode).not.toHaveBeenCalled();
  await user.click(within(ask).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.setDefaultPermissionMode).not.toHaveBeenCalled();
  expect(screen.queryByRole("group", { name: "Use Autopilot?" })).toBeNull();
  await user.click(within(group).getByRole("radio", { name: /Autopilot/ }));
  await user.click(screen.getByRole("button", { name: "Use Autopilot" }));
  expect(fake.raw.setDefaultPermissionMode).toHaveBeenCalledWith("autopilot");
});

test("until Autopilot is confirmed the track stays on the old mode", async () => {
  const { user } = mount("/settings/chat");
  const group = await modes();
  await user.click(within(group).getByRole("radio", { name: /Autopilot/ }));
  expect(within(group).getByRole("radio", { name: /Balanced/ }).getAttribute("aria-checked")).toBe("true");
  expect(states(group)).toEqual(["alone", "alone", "asks", "lock"]);
});

test("a refused mode save says why", async () => {
  const { fake, user } = mount("/settings/chat");
  fake.raw.setDefaultPermissionMode.mockRejectedValue(rpcError(-32603, "config.toml changed on disk; reload"));
  await user.click(within(await modes()).getByRole("radio", { name: /Careful/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("changed on disk");
});

test("Start with a plan sends chat.set", async () => {
  const { fake, user } = mount("/settings/chat");
  const toggle = await screen.findByRole("switch", { name: "Start with a plan" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  fake.raw.getChat.mockResolvedValue({ instructions: [], plan_first: true, mode: "balanced" });
  await user.click(toggle);
  expect(fake.raw.setChat).toHaveBeenCalledWith({ plan_first: true });
  await waitFor(() => expect(screen.getByRole("switch", { name: "Start with a plan" }).getAttribute("aria-checked")).toBe("true"));
  const first = zones(await modes())[0];
  expect(first?.getAttribute("data-zone")).toBe("plan");
  expect(first?.textContent).toContain("Shows a plan");
  expect(first?.textContent).toContain("waits for your yes");
});

test("a new session leaves plan first to the daemon, which follows [chat] plan_first", async () => {
  const { fake, user } = mount("/");
  await user.type(await screen.findByRole("textbox", { name: "Message" }), "hello{Enter}");
  await waitFor(() => expect(fake.raw.createSession).toHaveBeenCalled());
  expect(fake.raw.createSession.mock.calls[0]?.[0]).not.toHaveProperty("plan_first");
});

test("search finds default mode, autopilot and plan in Chat", () => {
  for (const query of ["default mode", "autopilot", "plan"]) {
    expect(searchSettings(query).map((match) => match.section.id)).toContain("chat");
  }
});

test("the page has no accessibility violations", async () => {
  const { container } = mount("/settings/chat");
  await modes();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});
