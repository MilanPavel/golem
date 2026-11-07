import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { McpServer } from "../../store/mcp.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { OK_ROWS, WORKING_LISTING } from "../setup/sample.ts";
import { closeSetup } from "../setup/index.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

const git: McpServer = {
  name: "git",
  state: "running",
  command: "mcp-server-git --repository /Users/me/repo",
  tools: ["mcp__git__git_status", "mcp__git__git_log"],
  schema_tokens: 1300,
  config: "/Users/me/.golem/config.toml",
  on_demand: false,
  enabled: null,
};
const github: McpServer = {
  name: "github",
  state: "failed",
  command: "https://api.githubcopilot.com/mcp/",
  error: "401 Unauthorized",
  retry_seconds: 5,
  config: "/Users/me/.golem/config.toml",
  on_demand: false,
  enabled: null,
};
const lazy: McpServer = {
  name: "lazy",
  state: "idle",
  command: "npx -y lazy-server",
  config: "/Users/me/.golem/config.toml",
  on_demand: true,
  enabled: false,
};
const off: McpServer = {
  name: "off",
  state: "disabled",
  command: "npx -y off-server",
  config: "/Users/me/.golem/config.toml",
  on_demand: false,
  enabled: null,
};
const mine: McpServer = {
  name: "db",
  state: "running",
  command: "db-server",
  tools: ["mcp__db__query"],
  project: "/work/app",
  config: "/work/app/.golem/config.toml",
  on_demand: false,
  enabled: true,
};

function mount(path: string, servers: readonly McpServer[], session: string | null = null, failing = false) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  if (failing) fake.raw.listMcp.mockRejectedValue(new Error("daemon is down"));
  else fake.raw.listMcp.mockResolvedValue({ servers: [...servers] });
  if (session !== null) settingsContextStore.set({ sessionId: session, cwd: "/work/app" });
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
  return { fake, page, user: userEvent.setup(), ...view };
}

const main = () => screen.getByRole("main");
const row = (name: string) => within(main()).getByRole("button", { name: new RegExp(`${name}`) });

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

test("the list groups servers by the file that names them, with each state in words", async () => {
  mount("/settings/mcp", [mine, git, github, lazy, off]);
  expect(await screen.findByText("5 servers")).toBeTruthy();
  const yours = within(main()).getByRole("region", { name: "Yours" });
  expect(yours.textContent).toContain("(/Users/me/.golem/config.toml)");
  const project = within(main()).getByRole("region", { name: "This project" });
  expect(project.textContent).toContain("(/work/app/.golem/config.toml)");
  expect(within(project).getByRole("button", { name: /db/ })).toBeTruthy();
  expect(within(yours).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "✔running, git2 tools · ≈1.3k tokens",
    "✘failed, github401 Unauthorized · retrying in 5s",
    "○idle (on demand), lazyon demand · off here",
    "–disabled, offdisabled",
  ]);
});

test("an empty list says 0 servers and how to add one", async () => {
  mount("/settings/mcp", []);
  expect(await screen.findByText("0 servers")).toBeTruthy();
  expect(screen.getByText(/golem mcp add --catalog/)).toBeTruthy();
});

test("a failed list says so, with Retry", async () => {
  const { fake, user } = mount("/settings/mcp", [], null, true);
  expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain("daemon is down");
  fake.raw.listMcp.mockResolvedValue({ servers: [git] });
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("1 server")).toBeTruthy();
});

test("a pushed status changes a row without a refresh", async () => {
  const { fake } = mount("/settings/mcp", [git]);
  expect((await screen.findAllByText(/2 tools/))[0]).toBeTruthy();
  fake.raw.listMcp.mockResolvedValue({ servers: [{ ...git, state: "failed", error: "exited", tools: [] }] });
  act(() => {
    fake.emitMcp();
  });
  expect(await screen.findByText("exited")).toBeTruthy();
});

test("a server's detail shows what the terminal shows, and a failed one says why and when it tries again", async () => {
  const { user } = mount("/settings/mcp", [git, github]);
  await user.click(await screen.findByRole("button", { name: /github/ }));
  const facts = within(main());
  expect(facts.getByRole("heading", { level: 3, name: "github" })).toBeTruthy();
  expect(facts.getByText("URL")).toBeTruthy();
  expect(facts.getByText("https://api.githubcopilot.com/mcp/")).toBeTruthy();
  expect(facts.getByText("/Users/me/.golem/config.toml")).toBeTruthy();
  expect(facts.getByText("401 Unauthorized")).toBeTruthy();
  expect(facts.getByText("in 5s")).toBeTruthy();
  expect(facts.queryByText("In this chat")).toBeNull();
  await user.click(facts.getByRole("button", { name: "Back" }));
  await user.click(await screen.findByRole("button", { name: /^running,\s*git(?!hub)/ }));
  expect(within(main()).getByText("2 tools · ≈1.3k tokens per prompt")).toBeTruthy();
});

test("with no session there is no per-chat choice, and with one there is", async () => {
  const none = mount("/settings/mcp", [lazy]);
  await none.user.click(await screen.findByRole("button", { name: /lazy/ }));
  expect(screen.queryByRole("button", { name: "Turn on for this chat" })).toBeNull();
  expect(within(main()).queryByText("In this chat")).toBeNull();
  none.unmount();
  settingsContextStore.set(null);
  const some = mount("/settings/mcp", [lazy], "a");
  await some.user.click(await screen.findByRole("button", { name: /lazy/ }));
  expect(within(main()).getByText("off · on demand")).toBeTruthy();
  await some.user.click(screen.getByRole("button", { name: "Turn on for this chat" }));
  expect(some.fake.raw.enableMcp).toHaveBeenCalledWith("a", "lazy");
  expect(await screen.findByText("lazy is on for this chat")).toBeTruthy();
});

test("Reconnect and Disable everywhere act at once", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  await user.click(await screen.findByRole("button", { name: /git/ }));
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  expect(fake.raw.restartMcp).toHaveBeenCalledWith("git", undefined);
  await user.click(screen.getByRole("button", { name: "Disable everywhere" }));
  expect(fake.raw.setMcpEnabled).toHaveBeenCalledWith("git", false, undefined);
  expect(await screen.findByText("git is disabled everywhere")).toBeTruthy();
});

test("enabling a disabled server asks first, showing the command, and acts only on Enable", async () => {
  const { fake, user } = mount("/settings/mcp", [off]);
  await user.click(await screen.findByRole("button", { name: /off/ }));
  await user.click(screen.getByRole("button", { name: "Enable for every chat" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Enable off?")).toBeTruthy();
  expect(within(dialog).getByText("npx -y off-server")).toBeTruthy();
  expect(within(dialog).getByText(/golem will run this on your Mac\./)).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.setMcpEnabled).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Enable on demand" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Enable" }));
  expect(fake.raw.setMcpEnabled).toHaveBeenCalledWith("off", "on_demand", undefined);
  await user.click(screen.getByRole("button", { name: "Enable for every chat" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Enable" }));
  expect(fake.raw.setMcpEnabled).toHaveBeenLastCalledWith("off", true, undefined);
});

test("a failed action shows the daemon's message", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.restartMcp.mockRejectedValue(new Error("no such server"));
  await user.click(await screen.findByRole("button", { name: /git/ }));
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  expect((await screen.findByRole("alert")).textContent).toContain("no such server");
});

test("View tools lists the tools without the prefix, and says so when there are none", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpTools.mockResolvedValue({
    name: "git",
    tools: [
      { name: "mcp__git__git_status", description: "Shows the status.\nMore." },
      { name: "mcp__git__git_log", description: "Shows the log." },
    ],
  });
  await user.click(await screen.findByRole("button", { name: /git/ }));
  await user.click(screen.getByRole("button", { name: "View tools" }));
  const list = await screen.findByRole("list", { name: "git tools" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "git_statusShows the status.",
    "git_logShows the log.",
  ]);
  expect(fake.raw.mcpTools).toHaveBeenCalledWith("git", undefined);
  fake.raw.mcpTools.mockResolvedValue({ name: "git", tools: [] });
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(within(main()).getByRole("heading", { level: 3, name: "git" })).toBeTruthy();
});

test("Back from a detail gives focus back to its row", async () => {
  const { user } = mount("/settings/mcp", [git, github]);
  await user.click(await screen.findByRole("button", { name: /github/ }));
  await user.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(document.activeElement).toBe(row("github")));
});

test("axe finds nothing on the list, a detail, and the confirm, in both themes", async () => {
  for (const theme of ["slip", "kiln"]) {
    document.documentElement.dataset.theme = theme;
    const { user, container, unmount } = mount("/settings/mcp", [git, off]);
    await screen.findByText("2 servers");
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(row("off"));
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Enable for every chat" }));
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    unmount();
  }
});
