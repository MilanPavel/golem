import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { ConfigGetResult } from "../../store/config.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { closeSetup } from "../setup/index.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const FOLDER = "/Users/you/repos/golem";

const CONFIG: ConfigGetResult = {
  config_file: "/Users/you/.golem/config.toml",
  default_model: null,
  log_level: "INFO",
  session_titles: true,
  trusted_projects: [],
  project_trusted: true,
  rules: [
    { tool: "shell", match: "git status", action: "allow", source: "~/.golem/config.toml rule 1", file: "user", index: 1 },
    { tool: "shell", action: "ask", source: "~/.golem/config.toml rule 2", file: "user", index: 2 },
    { tool: "write_file", path: "/etc/**", action: "deny", source: "golem/.golem/policy.toml rule 1", file: "project", index: 1 },
    { tool: "*", action: "allow", source: "golem/.golem/policy.toml rule 2", ignored: "not trusted", file: "project", index: 2 },
    { tool: "read_file", action: "allow", source: "built-in default" },
  ],
  session_allowed: [{ tool: "shell", subject: "ls -la" }],
};

function mount(path: string, config: ConfigGetResult | "fail" = CONFIG, withSession = true) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  if (config === "fail") fake.raw.getConfig.mockRejectedValue(new Error("no config"));
  else fake.raw.getConfig.mockResolvedValue(config);
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  if (withSession) {
    act(() => {
      fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", FOLDER));
    });
    settingsContextStore.set({ sessionId: "a", cwd: FOLDER });
  }
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, user: userEvent.setup(), ...view };
}

const rows = () => within(screen.getByRole("list", { name: "Tool rules" })).getAllByRole("listitem");
const group = (name: string) => screen.getByRole("group", { name });

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closeSetup();
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("the default mode is shown read-only with the line to set and a copy button, and the built-in rules keep their source", async () => {
  mount("/settings/rules", {
    ...CONFIG,
    default_permission_mode: "autopilot",
    permission_mode: "autopilot",
    rules: [{ tool: "write_file", action: "allow", source: "built-in default (autopilot)" }],
  });
  const modes = await screen.findByRole("radiogroup", { name: "Default mode" });
  const radios = within(modes).getAllByRole("radio");
  expect(radios.map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])).toEqual([
    ["Careful", "false"],
    ["Balanced", "false"],
    ["Autopilot", "true"],
  ]);
  expect(radios.every((radio) => radio.getAttribute("aria-disabled") === "true")).toBe(true);
  const section = modes.closest("section") as HTMLElement;
  expect(section.textContent).toContain("Also edits inside the project");
  expect(section.textContent).toContain("[permissions] mode in /Users/you/.golem/config.toml");
  expect(within(section).getByText('mode = "autopilot"')).toBeTruthy();
  expect(within(section).getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(rows()[0]?.textContent).toContain("built-in default (autopilot)");
  const results = await axe.run(section, noContrast);
  expect(results.violations).toEqual([]);
});

test("without a default from the daemon the section reads balanced", async () => {
  mount("/settings/rules");
  const modes = await screen.findByRole("radiogroup", { name: "Default mode" });
  expect(within(modes).getByRole("radio", { name: "Balanced" }).getAttribute("aria-checked")).toBe("true");
});

test("the section lists the rules in order, then the allowance, with the terminal's words", async () => {
  const { fake } = mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  expect(fake.raw.getConfig).toHaveBeenCalledWith(FOLDER, "a");
  const text = rows().map((row) => row.textContent);
  expect(text[0]).toContain("allow" + " shell match \"git status\"");
  expect(text[0]).toContain("~/.golem/config.toml rule 1");
  expect(text[1]).toContain("ask shell");
  expect(text[2]).toContain('deny write_file path "/etc/**"');
  expect(text[3]).toContain("ignored: not trusted");
  expect(text[4]).toContain("built-in default");
  expect(text[5]).toContain("session allow shell ls -la (for this session)");
  expect(rows()).toHaveLength(6);
});

test("a default rule has no buttons and says it is locked; an ignored rule is dimmed", async () => {
  mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  const list = rows();
  expect(within(list[4]!).queryByRole("button")).toBeNull();
  expect(list[4]!.textContent).toContain("built-in defaults cannot be changed");
  expect(list[4]!.className).toContain("opacity-70");
  expect(list[3]!.className).toContain("opacity-70");
  expect(list[0]!.className).not.toContain("opacity-70");
  expect(within(group("Action for shell rule 1")).getByRole("button", { name: "Allow" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(group("Action for shell rule 1")).getByRole("button", { name: "Deny" }).getAttribute("aria-pressed")).toBe("false");
});

test("Allow on an ask rule asks first, and acts only after the confirm", async () => {
  const { fake, user } = mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  await user.click(within(group("Action for shell rule 2")).getByRole("button", { name: "Allow" }));
  const dialog = await screen.findByRole("dialog", { name: "Allow shell without asking?" });
  expect(dialog.textContent).toContain("golem will not ask before it runs this on your Mac.");
  expect(fake.raw.updateRule).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(within(dialog).getByRole("button", { name: "Allow" }));
  expect(fake.raw.updateRule).toHaveBeenCalledWith("user", 2, "allow");
  expect(await screen.findByText("rule 2 now allows")).toBeTruthy();
  await waitFor(() => expect(fake.raw.getConfig.mock.calls.length).toBeGreaterThan(1));
});

test("Cancel in the confirm changes nothing", async () => {
  const { fake, user } = mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  await user.click(within(group("Action for shell rule 2")).getByRole("button", { name: "Allow" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.updateRule).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("Deny on an allow rule acts at once, and a project rule sends the folder", async () => {
  const { fake, user } = mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  await user.click(within(group("Action for shell rule 1")).getByRole("button", { name: "Deny" }));
  expect(fake.raw.updateRule).toHaveBeenCalledWith("user", 1, "deny");
  await user.click(within(group("Action for write_file rule 1")).getByRole("button", { name: "Ask" }));
  expect(fake.raw.updateRule).toHaveBeenCalledWith("project", 1, "ask", FOLDER);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("Remove acts at once on an allow rule and asks on a deny rule", async () => {
  const { fake, user } = mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  await user.click(screen.getByRole("button", { name: "Remove shell rule 1" }));
  expect(fake.raw.removeRule).toHaveBeenCalledWith("user", 1);
  expect(await screen.findByText("rule 1 removed")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Remove write_file rule 1" }));
  const dialog = await screen.findByRole("dialog", { name: "Remove this rule?" });
  expect(fake.raw.removeRule).toHaveBeenCalledTimes(1);
  await user.click(within(dialog).getByRole("button", { name: "Remove" }));
  expect(fake.raw.removeRule).toHaveBeenLastCalledWith("project", 1, FOLDER);
});

test("Revoke drops the session's allowance", async () => {
  const { fake, user } = mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  await user.click(screen.getByRole("button", { name: "Revoke shell ls -la" }));
  expect(fake.raw.revokeAllowance).toHaveBeenCalledWith("a", "shell", "ls -la");
  expect(await screen.findByText("shell is no longer allowed for this session")).toBeTruthy();
});

test("an error from the daemon shows in a red line, and the list is read again", async () => {
  const { fake, user } = mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  fake.raw.updateRule.mockRejectedValue(rpcError(-32602, "rule 1 is out of range"));
  const before = fake.raw.getConfig.mock.calls.length;
  await user.click(within(group("Action for shell rule 1")).getByRole("button", { name: "Ask" }));
  expect((await screen.findByRole("alert")).textContent).toContain("rule 1 is out of range");
  await waitFor(() => expect(fake.raw.getConfig.mock.calls.length).toBeGreaterThan(before));
});

test("an answer to an approval reads the rules again", async () => {
  const { fake } = mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  const before = fake.raw.getConfig.mock.calls.length;
  act(() => {
    fake.emitEvent(ev("a", "approval.resolved", { call_id: "c1", decision: "allow_session", name: "shell" }));
  });
  await waitFor(() => expect(fake.raw.getConfig.mock.calls.length).toBeGreaterThan(before));
});

test("Refresh reads again, and a failed read shows the error with Retry", async () => {
  const { fake, user } = mount("/settings/rules", "fail");
  // The query retries once, after a short wait.
  expect((await screen.findByRole("alert", {}, { timeout: 5000 })).textContent).toContain("no config");
  fake.raw.getConfig.mockResolvedValue(CONFIG);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("list", { name: "Tool rules" });
  const before = fake.raw.getConfig.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fake.raw.getConfig.mock.calls.length).toBeGreaterThan(before));
});

test("with no folder there is a hint, no folder is sent, and no allowance can be revoked", async () => {
  const { fake } = mount("/settings/rules", { ...CONFIG, session_allowed: [], project_trusted: null, rules: CONFIG.rules.slice(0, 2) }, false);
  await screen.findByRole("list", { name: "Tool rules" });
  expect(fake.raw.getConfig).toHaveBeenCalledWith(undefined, undefined);
  expect(screen.getByText("Open a session to see its folder's rules.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Revoke/ })).toBeNull();
});

test("the trust line shows only when the folder is not trusted", async () => {
  const { unmount } = mount("/settings/rules", { ...CONFIG, project_trusted: false });
  expect(await screen.findByText("This folder's allow rules do not count until the folder is trusted.")).toBeTruthy();
  unmount();
  mount("/settings/rules");
  await screen.findByRole("list", { name: "Tool rules" });
  expect(screen.queryByText(/until the folder is trusted/)).toBeNull();
});

for (const theme of ["slip", "kiln"] as const) {
  test(`no accessibility violations on the Tool rules section, and with the confirm open, in ${theme}`, async () => {
    const { container, user } = mount("/settings/rules");
    document.documentElement.dataset.theme = theme;
    await screen.findByRole("list", { name: "Tool rules" });
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(within(group("Action for shell rule 2")).getByRole("button", { name: "Allow" }));
    await screen.findByRole("dialog");
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
  });
}
