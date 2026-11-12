import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { McpServer, McpToolsResult } from "../../store/mcp.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { OK_ROWS, WORKING_LISTING } from "../setup/sample.ts";
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

function mount(path: string, servers: readonly McpServer[], session: string | null = null, failing = false, prepare?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  if (failing) fake.raw.listMcp.mockRejectedValue(new Error("daemon is down"));
  else fake.raw.listMcp.mockResolvedValue({ servers: [...servers] });
  prepare?.(fake);
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

/** Picks an item of the "More actions" menu of the server shown. */
async function menu(user: ReturnType<typeof userEvent.setup>, server: string, item: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: `More actions for ${server}` }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

const GIT_ROW = /^running,\s*git(?!hub)/;
const DB_ROW = /^running,\s*db/;
const main = () => screen.getByRole("main");
const row = (name: string) => within(main()).getByRole("button", { name: new RegExp(`^(?!More actions).*${name}`) });

/** jsdom has no layout; `narrow` says which side of the breakpoint the window is on. */
function stubWidth(narrow: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow, media: query, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  stubWidth(true);
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
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
    "running, gitrunning2 tools · 1.3K tokens",
    "failed, githubfailed401 Unauthorized · retry in 5s",
    "on demand, lazyon demand",
    "disabled, offdisabled",
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
  expect(facts.getByText("https://api.githubcopilot.com/mcp/")).toBeTruthy();
  expect(facts.getByText("Yours · ~/.golem/config.toml")).toBeTruthy();
  expect(facts.getByText("401 Unauthorized · retry in 5s")).toBeTruthy();
  expect(facts.getByText("failed")).toBeTruthy();
  await user.click(facts.getByRole("button", { name: "Back" }));
  await user.click(await screen.findByRole("button", { name: /^running,\s*git(?!hub)/ }));
  expect(within(main()).getByText("running")).toBeTruthy();
  expect(within(main()).getByText("Tools")).toBeTruthy();
});

test("with no session there is no per-chat choice, and with one there is", async () => {
  const none = mount("/settings/mcp", [lazy]);
  await none.user.click(await screen.findByRole("button", { name: /lazy/ }));
  expect(screen.queryByRole("button", { name: "Turn on in this chat" })).toBeNull();
  expect(within(main()).getAllByRole("button", { name: "Start" }).length).toBeGreaterThan(0);
  expect(within(main()).queryByText(/in this chat/)).toBeNull();
  none.unmount();
  settingsContextStore.set(null);
  const some = mount("/settings/mcp", [lazy], "a");
  await some.user.click(await screen.findByRole("button", { name: /lazy/ }));
  await some.user.click(screen.getByRole("button", { name: "Turn on in this chat" }));
  expect(some.fake.raw.enableMcp).toHaveBeenCalledWith("a", "lazy");
  expect(await screen.findByText("lazy is on for this chat")).toBeTruthy();
});

test("an idle server starts from Start, with or without a chat", async () => {
  const { fake, user } = mount("/settings/mcp", [lazy]);
  await user.click(await screen.findByRole("button", { name: /lazy/ }));
  expect(screen.getByText("lazy is not running.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  await user.click(within(main()).getAllByRole("button", { name: "Start" })[0]!);
  expect(fake.raw.restartMcp).toHaveBeenCalledWith("lazy", undefined);
  expect(await screen.findByText("starting lazy…")).toBeTruthy();
});

test("Reconnect and Disable everywhere act at once", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  await user.click(await screen.findByRole("button", { name: /git/ }));
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  expect(fake.raw.restartMcp).toHaveBeenCalledWith("git", undefined);
  await menu(user, "git", "Disable everywhere");
  expect(fake.raw.setMcpEnabled).toHaveBeenCalledWith("git", false, undefined);
  expect(await screen.findByText("git is disabled everywhere")).toBeTruthy();
});

test("enabling a disabled server asks first, showing the command, and acts only on Enable", async () => {
  const { fake, user } = mount("/settings/mcp", [off]);
  await user.click(await screen.findByRole("button", { name: /off/ }));
  await menu(user, "off", "Enable for every chat");
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Enable off?")).toBeTruthy();
  expect(within(dialog).getByText("npx -y off-server")).toBeTruthy();
  expect(within(dialog).getByText(/golem will run this on your Mac\./)).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.setMcpEnabled).not.toHaveBeenCalled();
  await menu(user, "off", "On demand");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Enable" }));
  expect(fake.raw.setMcpEnabled).toHaveBeenCalledWith("off", "on_demand", undefined);
  await menu(user, "off", "Enable for every chat");
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

test("the Tools tab lists the tools without the prefix, and says so when there are none", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpTools.mockResolvedValue({
    name: "git",
    tools: [
      { name: "mcp__git__git_status", description: "Shows the status.\nMore.", schema_tokens: 300 },
      { name: "mcp__git__git_log", description: "Shows the log.", schema_tokens: 100, hidden: true },
    ],
  });
  await user.click(await screen.findByRole("button", { name: /git/ }));
  const list = await screen.findByRole("list", { name: "git tools" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "git_statusShows the status.300▸",
    "git_logShows the log.hidden▸",
  ]);
  expect(screen.getByText(/1 of 2 on · about 300 tokens a turn/)).toBeTruthy();
  await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "LOG");
  expect(within(list).getAllByRole("listitem").length).toBe(1);
  expect(fake.raw.mcpTools).toHaveBeenCalledWith("git", undefined);
  expect(within(main()).getByRole("heading", { level: 3, name: "git" })).toBeTruthy();
});

test("on a wide window the list and the selected server's details sit side by side, and the first is shown at once", async () => {
  stubWidth(false);
  const { user, container } = mount("/settings/mcp", [git, github]);
  expect(await screen.findByRole("heading", { name: "git" })).toBeTruthy();
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  expect(screen.getByRole("button", { name: GIT_ROW }).getAttribute("aria-current")).toBe("true");
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  await user.click(row("github"));
  expect(await screen.findByRole("heading", { name: "github" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "git" })).toBeNull();
  expect(row("github").getAttribute("aria-current")).toBe("true");
  expect(screen.getByRole("button", { name: GIT_ROW }).getAttribute("aria-current")).toBeNull();
  expect(screen.getByText("401 Unauthorized · retry in 5s", { selector: "p" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /Add a server|Import/ }).length).toBe(2);
});

test("on a wide window the list and the selected server's details sit side by side, and the first is shown at once", async () => {
  stubWidth(false);
  const { user } = mount("/settings/mcp", [git, github]);
  expect(await screen.findByRole("heading", { name: "git" })).toBeTruthy();
  expect(screen.getByRole("button", { name: GIT_ROW }).getAttribute("aria-current")).toBe("true");
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  await user.click(row("github"));
  expect(await screen.findByRole("heading", { name: "github" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "git" })).toBeNull();
  expect(row("github").getAttribute("aria-current")).toBe("true");
  expect(screen.getByRole("button", { name: GIT_ROW }).getAttribute("aria-current")).toBeNull();
  expect(screen.getByText("401 Unauthorized · retry in 5s", { selector: "p" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /Add a server|Import/ }).length).toBe(2);
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
    await menu(user, "off", "Enable for every chat");
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    unmount();
  }
});

type Tool = McpToolsResult["tools"][number];
const logTool: Tool = {
  name: "mcp__git__git_log",
  description: "Shows the log.",
  schema_tokens: 100,
  input_schema: { type: "object", required: ["path"], properties: { path: { type: "string", description: "The repo." }, count: { type: "integer" } } },
};
const rawTool: Tool = {
  name: "mcp__git__raw",
  description: "Takes anything.",
  schema_tokens: 50,
  input_schema: { type: "object", properties: { filter: { type: "object" } } },
};
const withTools = { name: "git", tools: [logTool, rawTool] };

async function openTools(user: ReturnType<typeof userEvent.setup>, fake: ReturnType<typeof mount>["fake"]) {
  fake.raw.mcpTools.mockResolvedValue(withTools);
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await screen.findByRole("list", { name: "git tools" });
}

test("a switch hides a tool from the model by writing tools.exclude, and shows it again", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpGet.mockResolvedValue({ config: { tools: { include: [], exclude: [] } } } as never);
  await openTools(user, fake);
  fake.raw.mcpTools.mockResolvedValue({ ...withTools, tools: [{ ...logTool, hidden: true }, rawTool] });
  await user.click(screen.getByRole("switch", { name: "Show git_log to the model" }));
  expect(fake.raw.updateMcpServer).toHaveBeenCalledWith({ name: "git", config: { tools: { include: [], exclude: ["git_log"] } } });
  expect(await screen.findByText("git_log is hidden from the model")).toBeTruthy();
  fake.raw.mcpGet.mockResolvedValue({ config: { tools: { include: [], exclude: ["git_log"] } } } as never);
  await waitFor(() => expect(screen.getByRole("switch", { name: "Show git_log to the model" }).getAttribute("aria-checked")).toBe("false"));
  await user.click(screen.getByRole("switch", { name: "Show git_log to the model" }));
  expect(fake.raw.updateMcpServer).toHaveBeenLastCalledWith({ name: "git", config: { tools: { include: [], exclude: [] } } });
});

test("a tool hidden by a pattern cannot be shown from here, and says why", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpGet.mockResolvedValue({ config: { tools: { include: [], exclude: ["git_*"] } } } as never);
  fake.raw.mcpTools.mockResolvedValue({ ...withTools, tools: [{ ...logTool, hidden: true }] });
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(await screen.findByRole("switch", { name: "Show git_log to the model" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not a hidden pattern");
  expect(fake.raw.updateMcpServer).not.toHaveBeenCalled();
});

test("Try a tool draws a form from its schema, sends typed arguments, and shows the result", async () => {
  const { fake, user } = mount("/settings/mcp", [git], "a");
  fake.raw.mcpCall.mockResolvedValue({ text: "commit 1\ncommit 2", is_error: false });
  await openTools(user, fake);
  await user.click(screen.getByRole("button", { name: "Try git_log" }));
  const dialog = main();
  expect(screen.getByRole("tab", { name: "Try a tool", selected: true })).toBeTruthy();
  expect(within(dialog).getByText(/Runs now, without asking/)).toBeTruthy();
  expect(within(dialog).getByText("The repo.")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Run" }));
  expect(within(dialog).getByText("Required.")).toBeTruthy();
  expect(fake.raw.mcpCall).not.toHaveBeenCalled();
  await user.type(within(dialog).getByLabelText("path (required)"), "/repo");
  await user.type(within(dialog).getByLabelText("count"), "3");
  await user.click(within(dialog).getByRole("button", { name: "Run" }));
  expect(fake.raw.mcpCall).toHaveBeenCalledWith({ name: "git", tool: "git_log", arguments: { path: "/repo", count: 3 }, sessionId: "a" });
  expect((await within(dialog).findByText(/commit 1/)).textContent).toBe("commit 1\ncommit 2");
});

test("a tool whose schema has no form takes JSON, and a refused call shows the daemon's message", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  await openTools(user, fake);
  await user.click(screen.getByRole("button", { name: "Try raw" }));
  const dialog = main();
  expect(within(dialog).queryByRole("button", { name: "Use the form" })).toBeNull();
  await user.click(within(dialog).getByLabelText("Arguments (JSON)"));
  await user.paste("[1]");
  await user.click(within(dialog).getByRole("button", { name: "Run" }));
  expect(within(dialog).getByRole("alert").textContent).toContain("must be a JSON object");
  await user.clear(within(dialog).getByLabelText("Arguments (JSON)"));
  fake.raw.mcpCall.mockRejectedValue(new Error("server is not running"));
  await user.click(within(dialog).getByRole("button", { name: "Run" }));
  expect(fake.raw.mcpCall).toHaveBeenCalledWith({ name: "git", tool: "raw", arguments: {} });
  expect((await within(dialog).findByRole("alert")).textContent).toContain("server is not running");
});

test("a tool that reports an error says so", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpCall.mockResolvedValue({ text: "no such repo", is_error: true });
  await openTools(user, fake);
  await user.click(screen.getByRole("button", { name: "Try raw" }));
  await user.click(within(main()).getByRole("button", { name: "Run" }));
  expect(await screen.findByText("The tool reported an error:")).toBeTruthy();
  expect(screen.getByText("no such repo")).toBeTruthy();
});

test("Test the connection shows each step as it ends, then what it found, and runs again", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpTest.mockImplementation(async (_params, onProgress) => {
    onProgress?.({ test_id: "t", step: "resolve", state: "ok", elapsed_ms: 3 });
    onProgress?.({ test_id: "t", step: "spawn", state: "running" });
    return { test_id: "t", ok: true, steps: [], tools: [{ name: "a", description: "" }], stderr_tail: [], server_info: { name: "git", version: "1.0" } } as never;
  });
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("button", { name: "Test" }));
  const steps = await screen.findByRole("list", { name: "Test steps" });
  expect(within(steps).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["✓ resolve 0m 00.003s"]);
  expect(await screen.findByText(/ok: git 1.0, 1 tools/)).toBeTruthy();
  expect(fake.raw.mcpTest).toHaveBeenCalledWith({ name: "git" }, expect.any(Function));
  await user.click(screen.getByRole("button", { name: "Test again" }));
  await waitFor(() => expect(fake.raw.mcpTest).toHaveBeenCalledTimes(2));
});

test("a failed test shows what the server said and the hint, and a refused one shows the message", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpTest.mockResolvedValue({ test_id: "t", ok: false, steps: [], tools: [], stderr_tail: ["boom"], hint: "Install Node." } as never);
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("button", { name: "Test" }));
  expect(await screen.findByText("✘ failed")).toBeTruthy();
  expect(screen.getByText("boom")).toBeTruthy();
  expect(screen.getByText("Install Node.")).toBeTruthy();
  fake.raw.mcpTest.mockRejectedValue(new Error("no such server"));
  await user.click(screen.getByRole("button", { name: "Test again" }));
  expect((await screen.findByRole("alert")).textContent).toContain("no such server");
});

test("the log shows its lines, adds new ones as they come, and follows unless turned off", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpLogs.mockResolvedValue({ name: "git", lines: [{ ts: 0, kind: "stderr", text: "starting" }] });
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("tab", { name: "Logs" }));
  const log = await screen.findByRole("log", { name: "git log" });
  expect(log.textContent).toContain("starting");
  act(() => {
    fake.emitMcpLog({ name: "other", lines: [{ ts: 1, kind: "event", text: "not mine" }] });
    fake.emitMcpLog({ name: "git", lines: [{ ts: 2, kind: "stderr", text: "ready" }] });
  });
  expect(log.textContent).toContain("ready");
  expect(log.textContent).not.toContain("not mine");
  const follow = screen.getByRole("checkbox", { name: "Follow" }) as HTMLInputElement;
  expect(follow.checked).toBe(true);
  await user.click(follow);
  expect(follow.checked).toBe(false);
  expect(fake.raw.mcpLogs).toHaveBeenCalledWith("git", {});
});

test("an empty log says so", async () => {
  const { user } = mount("/settings/mcp", [git]);
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("tab", { name: "Logs" }));
  expect(await screen.findByText("Nothing logged yet.")).toBeTruthy();
});

test("Remove asks first, names the file, and acts only on Remove; a project's server has no Remove", async () => {
  const { fake, user } = mount("/settings/mcp", [git, mine]);
  await user.click(await screen.findByRole("button", { name: DB_ROW }));
  await user.click(screen.getByRole("button", { name: "More actions for db" }));
  expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await menu(user, "git", "Remove");
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Remove git?")).toBeTruthy();
  expect(within(dialog).getByText("/Users/me/.golem/config.toml")).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.removeMcpServer).not.toHaveBeenCalled();
  await menu(user, "git", "Remove");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
  expect(fake.raw.removeMcpServer).toHaveBeenCalledWith("git");
});

test("a refused remove shows the daemon's message", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.removeMcpServer.mockRejectedValue(new Error("not yours to remove"));
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await menu(user, "git", "Remove");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not yours to remove");
});

test("axe finds nothing on the tools, the try dialog, the test, and the log, in both themes", async () => {
  for (const theme of ["slip", "kiln"]) {
    document.documentElement.dataset.theme = theme;
    const { fake, user, container, unmount } = mount("/settings/mcp", [git]);
    fake.raw.mcpLogs.mockResolvedValue({ name: "git", lines: [{ ts: 0, kind: "stderr", text: "x" }] });
    await openTools(user, fake);
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Try git_log" }));
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "Tools" }));
    await user.click(screen.getByRole("button", { name: "Test" }));
    await screen.findByRole("list", { name: "Test steps" });
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "Logs" }));
    await screen.findByRole("log", { name: "git log" });
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    unmount();
  }
});

const detailOf = (server: McpServer, config: Record<string, unknown>) => ({ config, path: server.config ?? "", scope: "user" as const, secrets: [], server }) as never;

test("Edit shows the config as a form, and Save sends the change with a stored secret kept as it is", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpGet.mockResolvedValue(
    detailOf(git, { command: "mcp-server-git", args: ["--repository", "/Users/me/repo"], env: { TOKEN: "keychain:mcp/git-token", MODE: "fast" }, timeout_seconds: 30 }),
  );
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("tab", { name: "Edit" }));
  const command = await screen.findByLabelText("Command");
  expect((command as HTMLInputElement).value).toBe("mcp-server-git --repository /Users/me/repo");
  expect((screen.getByLabelText("variable 1 value") as HTMLInputElement).placeholder).toContain("stored in the Keychain");
  await user.clear(screen.getByLabelText("Timeout (seconds)"));
  await user.type(screen.getByLabelText("Timeout (seconds)"), "60");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(fake.raw.updateMcpServer).toHaveBeenCalledTimes(1);
  const sent = fake.raw.updateMcpServer.mock.calls[0]![0];
  expect(sent.name).toBe("git");
  expect(sent.config.timeout_seconds).toBe(60);
  expect(sent.config.env).toEqual({ TOKEN: "keychain:mcp/git-token", MODE: "fast" });
  expect(sent.secrets).toBeUndefined();
  expect(await screen.findByRole("heading", { name: "git" })).toBeTruthy();
});

test("the Tools tab tags the tools the server says are read-only", async () => {
  const { fake, user } = mount("/settings/mcp", [{ ...git, approval: "read-only" }]);
  fake.raw.mcpTools.mockResolvedValue({
    name: "git",
    tools: [
      { name: "mcp__git__git_status", description: "Shows the status.", schema_tokens: 300, read_only: true },
      { name: "mcp__git__git_push", description: "Pushes.", schema_tokens: 100 },
    ],
  });
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  const list = await screen.findByRole("list", { name: "git tools" });
  const [status, push] = within(list).getAllByRole("listitem");
  expect(within(status!).getByText("read-only")).toBeTruthy();
  expect(within(push!).queryByText("read-only")).toBeNull();
});

test("Edit offers three approvals, and Save sends the chosen one", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpGet.mockResolvedValue(detailOf(git, { command: "mcp-server-git", approval: "ask" }));
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("tab", { name: "Edit" }));
  const approval = (await screen.findByLabelText("Approval")) as HTMLSelectElement;
  expect(within(approval).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Ask before every tool",
    "Trust its read-only tools",
    "Allow every tool",
  ]);
  await user.selectOptions(approval, "Trust its read-only tools");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(fake.raw.updateMcpServer.mock.calls[0]![0].config.approval).toBe("read-only");
});

test("Edit replaces a secret only when a new one is typed, and says what is wrong before sending", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpGet.mockResolvedValue(detailOf(git, { command: "x", env: { TOKEN: "keychain:mcp/git-token" } }));
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("tab", { name: "Edit" }));
  await user.type(await screen.findByLabelText("variable 1 value"), "s3cret");
  await user.clear(screen.getByLabelText("Command"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Type a command or an https:// URL.");
  expect(fake.raw.updateMcpServer).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText("Command"), "x");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(fake.raw.updateMcpServer.mock.calls[0]![0].secrets).toEqual({ "mcp/git-token": "s3cret" });
});

test("a refused save shows the daemon's message and keeps the form", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpGet.mockResolvedValue(detailOf(git, { command: "x" }));
  fake.raw.updateMcpServer.mockRejectedValue(new Error("the file changed"));
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("tab", { name: "Edit" }));
  await user.click(await screen.findByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("the file changed");
  expect(screen.getByLabelText("Command")).toBeTruthy();
});

test("a project's server has no Edit without a session, and has it with one", async () => {
  const first = mount("/settings/mcp", [mine]);
  await first.user.click(await screen.findByRole("button", { name: DB_ROW }));
  expect(screen.queryByRole("tab", { name: "Edit" })).toBeNull();
  first.unmount();
  mount("/settings/mcp", [mine], "s1");
  await userEvent.setup().click(await screen.findByRole("button", { name: DB_ROW }));
  expect(screen.getByRole("tab", { name: "Edit" })).toBeTruthy();
});

const FILES = {
  id: "filesystem",
  name: "filesystem",
  title: "Filesystem",
  description: "Read and write files in a folder.",
  category: "files",
  homepage: "https://example.com/fs",
  runtime: "npx",
  auth: "none",
  inputs: [{ id: "folder", kind: "path", label: "Folder", default: "{folder}", required: true }],
} as const;
const GITHUB = {
  id: "github",
  name: "github",
  title: "GitHub",
  description: "Issues and pull requests.",
  category: "code",
  homepage: "https://example.com/gh",
  runtime: "url",
  auth: "token",
  inputs: [{ id: "token", kind: "secret", label: "Token", hint: "A personal access token." }],
} as const;
const NEEDS_NODE = { ...FILES, id: "memory", name: "memory", title: "Memory", description: "Remember things.", category: "other", inputs: [], available: true, missing: "node" } as const;

test("Add lists what golem offers by category, searches it, and greys out what cannot be added", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [FILES, GITHUB, { ...NEEDS_NODE, available: false, reason: "Needs sign-in." }, { ...FILES, id: "done", title: "Done", added: true }] as never });
  await user.click(await screen.findByRole("button", { name: "Add a server" }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByRole("region", { name: "Files" })).toBeTruthy();
  expect(within(dialog).getByRole("region", { name: "Code" })).toBeTruthy();
  expect((within(dialog).getByRole("button", { name: /Memory/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(dialog).getByText(/Needs sign-in\./)).toBeTruthy();
  expect((within(dialog).getByRole("button", { name: /Done/ }) as HTMLButtonElement).disabled).toBe(true);
  await user.type(within(dialog).getByRole("textbox", { name: "Search the list" }), "pull");
  expect(within(dialog).queryByRole("region", { name: "Files" })).toBeNull();
  expect(within(dialog).getByRole("button", { name: /GitHub/ })).toBeTruthy();
  await user.clear(within(dialog).getByRole("textbox", { name: "Search the list" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Search the list" }), "zzz");
  expect(within(dialog).getByText(/Nothing in the list matches/)).toBeTruthy();
});

test("adding a catalog server fills the folder, keeps the token apart, tests the draft, and saves", async () => {
  const { fake, user } = mount("/settings/mcp", [git], "s1");
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [FILES, GITHUB] as never });
  await user.click(await screen.findByRole("button", { name: "Add a server" }));
  await user.click(await screen.findByRole("button", { name: /Filesystem/ }));
  const folder = screen.getByLabelText("Folder") as HTMLInputElement;
  expect(folder.value).toBe("/work/app");
  await user.clear(folder);
  await user.type(folder, "/work/other");
  await user.click(screen.getByRole("button", { name: "Test" }));
  await waitFor(() => expect(fake.raw.mcpTest).toHaveBeenCalled());
  expect(fake.raw.mcpTest.mock.calls[0]![0]).toMatchObject({ catalogId: "filesystem", inputs: { folder: "/work/other" }, name: "filesystem" });
  await user.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(fake.raw.addMcpServer).toHaveBeenCalled());
  expect(fake.raw.addMcpServer.mock.calls[0]![0]).toEqual({ name: "filesystem", catalog_id: "filesystem", inputs: { folder: "/work/other" }, secrets: {} });
  expect(await screen.findByText("added filesystem")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a secret input is hidden and goes in secrets, and a missing one is named", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [GITHUB] as never });
  await user.click(await screen.findByRole("button", { name: "Add a server" }));
  await user.click(await screen.findByRole("button", { name: /GitHub/ }));
  const token = screen.getByLabelText("Token") as HTMLInputElement;
  expect(token.type).toBe("password");
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Token is needed.");
  expect(fake.raw.addMcpServer).not.toHaveBeenCalled();
  await user.type(token, "ghp_abc");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(fake.raw.addMcpServer).toHaveBeenCalled());
  expect(fake.raw.addMcpServer.mock.calls[0]![0]).toMatchObject({ catalog_id: "github", inputs: {}, secrets: { token: "ghp_abc" } });
});

test("a refused add shows the daemon's message and keeps the dialog", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [FILES] as never });
  fake.raw.addMcpServer.mockRejectedValue(new Error("filesystem is already there"));
  await user.click(await screen.findByRole("button", { name: "Add a server" }));
  await user.click(await screen.findByRole("button", { name: /Filesystem/ }));
  await user.type(screen.getByLabelText("Folder"), "/x");
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect((await screen.findByRole("alert")).textContent).toContain("filesystem is already there");
  expect(screen.getByRole("dialog")).toBeTruthy();
});

test("another server takes a name and a command or URL, shows what will run, tests it, and saves it", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [FILES] as never });
  await user.click(await screen.findByRole("button", { name: "Add a server" }));
  await user.click(await screen.findByRole("button", { name: /Another server/ }));
  await user.type(screen.getByLabelText("Name"), "mine");
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Type a command or an https:// URL.");
  await user.type(screen.getByLabelText("Command or URL"), "npx -y @x/server 'a b'");
  expect(screen.getByText("npx -y @x/server 'a b'")).toBeTruthy();
  expect(screen.getByText("golem will run this on your Mac.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Test" }));
  await waitFor(() => expect(fake.raw.mcpTest).toHaveBeenCalled());
  expect(fake.raw.mcpTest.mock.calls[0]![0]).toMatchObject({ config: { command: "npx", args: ["-y", "@x/server", "a b"] } });
  await user.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(fake.raw.addMcpServer).toHaveBeenCalled());
  expect(fake.raw.addMcpServer.mock.calls[0]![0]).toEqual({ name: "mine", command: "npx", args: ["-y", "@x/server", "a b"] });
});

test("a URL says golem will connect, and a bad name is refused", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [] });
  await user.click(await screen.findByRole("button", { name: "Add a server" }));
  await user.click(await screen.findByRole("button", { name: /Another server/ }));
  await user.type(screen.getByLabelText("Name"), "-bad");
  expect(screen.getByText(/Use letters, digits, and dashes/)).toBeTruthy();
  await user.type(screen.getByLabelText("Command or URL"), "https://x.example/mcp");
  expect(screen.getByText("golem will connect to this address.")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(fake.raw.addMcpServer).not.toHaveBeenCalled();
});

test("a server that needs Node offers to install it, shows the output, and adds only once it is there", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [NEEDS_NODE] as never });
  await user.click(await screen.findByRole("button", { name: "Add a server" }));
  await user.click(await screen.findByRole("button", { name: /Memory/ }));
  expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Install Node" }));
  expect(fake.raw.installRuntime).toHaveBeenCalledWith("node");
  act(() => {
    fake.emitRuntime({ kind: "output", name: "node", text: "==> Downloading node\n" });
  });
  await waitFor(() => expect(within(screen.getByRole("dialog")).getByText(/Downloading node/)).toBeTruthy());
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [{ ...NEEDS_NODE, missing: null }] as never });
  act(() => {
    fake.emitRuntime({ kind: "done", done: { name: "node", ok: true } });
  });
  await waitFor(() => expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("button", { name: "Install Node" })).toBeNull();
});

test("a failed install says why", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [NEEDS_NODE] as never });
  await user.click(await screen.findByRole("button", { name: "Add a server" }));
  await user.click(await screen.findByRole("button", { name: /Memory/ }));
  await user.click(screen.getByRole("button", { name: "Install Node" }));
  act(() => {
    fake.emitRuntime({ kind: "done", done: { name: "node", ok: false, error: "brew is not installed" } });
  });
  expect((await screen.findByRole("alert")).textContent).toContain("brew is not installed");
});

test("axe finds nothing on the edit form, the list of servers to add, and the add forms, in both themes", async () => {
  for (const theme of ["slip", "kiln"]) {
    const { fake, user, unmount } = mount("/settings/mcp", [git]);
    document.documentElement.dataset.theme = theme;
    fake.raw.mcpGet.mockResolvedValue(detailOf(git, { command: "x", env: { A: "keychain:mcp/git-a", B: "b" } }));
    fake.raw.mcpCatalog.mockResolvedValue({ entries: [FILES, GITHUB] as never });
    await user.click(await screen.findByRole("button", { name: GIT_ROW }));
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    await screen.findByLabelText("Command");
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Add a server" }));
    await screen.findByRole("region", { name: "Files" });
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    await user.click(screen.getByRole("button", { name: /GitHub/ }));
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    unmount();
  }
});

const SCAN = {
  scan_id: "scan1",
  sources: [
    {
      id: "cursor",
      label: "Cursor",
      path: "/Users/me/.cursor/mcp.json",
      candidates: [
        { key: "a", name: "git", original_name: "git", scope: "user", config: { command: "uvx", args: ["mcp-server-git"] } },
        { key: "b", name: "gh-2", original_name: "gh", scope: "user", clash: true, config: { url: "https://x.example/mcp", headers: { Authorization: "keychain:mcp/gh-2" } }, secret_refs: ["mcp/gh-2"], missing_refs: ["mcp/gh-2"], warnings: ["Uses the old SSE transport."] },
        { key: "c", name: "old", original_name: "old", scope: "user", already_same: true, config: { command: "old" } },
      ],
      skipped: ["broken: no command"],
    },
    { id: "vscode", label: "VS Code", error: "not valid JSON" },
  ],
} as never;

async function openImport(fake: ReturnType<typeof mount>["fake"], user: ReturnType<typeof mount>["user"], scan: unknown = SCAN) {
  fake.raw.scanMcpImport.mockResolvedValue(scan as never);
  await user.click(await screen.findByRole("button", { name: "Import" }));
  return screen.findByRole("dialog");
}

test("Import lists what other apps have, picks every server golem lacks, and notes the rest", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  const dialog = await openImport(fake, user);
  expect(await within(dialog).findByText("3 servers in 1 place")).toBeTruthy();
  expect(within(dialog).getByText("/Users/me/.cursor/mcp.json", { exact: false })).toBeTruthy();
  expect((within(dialog).getByRole("checkbox", { name: "Import git" }) as HTMLInputElement).checked).toBe(true);
  expect((within(dialog).getByRole("checkbox", { name: "Import old" }) as HTMLInputElement).checked).toBe(false);
  expect(within(dialog).getByText("already added")).toBeTruthy();
  expect(within(dialog).getByText("will be named gh-2")).toBeTruthy();
  expect(within(dialog).getByText("! Uses the old SSE transport.")).toBeTruthy();
  expect(within(dialog).getByText("uvx mcp-server-git")).toBeTruthy();
  expect(within(dialog).getByText("Skipped broken: no command")).toBeTruthy();
  expect(within(dialog).getByText("not valid JSON")).toBeTruthy();
  expect(fake.raw.scanMcpImport).toHaveBeenCalledWith({});
});

test("Import adds the picked servers under the names typed, with a typed secret apart, and shows what happened", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.applyMcpImport.mockResolvedValue({ added: [{ name: "my-git", state: "running", command: "uvx" }, { name: "gh-2", state: "starting", command: "x" }], failed: [] } as never);
  const dialog = await openImport(fake, user);
  const name = await within(dialog).findByLabelText("Name of git");
  await user.clear(name);
  await user.type(name, "my-git");
  await user.type(within(dialog).getByLabelText("Value for mcp/gh-2"), "tok");
  await user.click(within(dialog).getByRole("button", { name: "Import 2 servers" }));
  await waitFor(() => expect(fake.raw.applyMcpImport).toHaveBeenCalled());
  expect(fake.raw.applyMcpImport.mock.calls[0]![0]).toEqual({
    scan_id: "scan1",
    picks: [
      { key: "a", name: "my-git", scope: "user" },
      { key: "b", name: "gh-2", scope: "user" },
    ],
    secrets: { "mcp/gh-2": "tok" },
  });
  expect(await within(screen.getByRole("dialog")).findByText("Added 2 servers.")).toBeTruthy();
  expect(within(screen.getByRole("dialog")).getByText("my-git · running")).toBeTruthy();
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(await screen.findByText("added my-git, gh-2")).toBeTruthy();
});

test("Import says what is wrong before sending, and unticking a server drops it and its secret", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  const dialog = await openImport(fake, user);
  await user.clear(await within(dialog).findByLabelText("Name of git"));
  await user.type(within(dialog).getByLabelText("Name of git"), "bad name");
  await user.click(within(dialog).getByRole("button", { name: "Import 2 servers" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("git: Use letters, digits, and dashes");
  expect(fake.raw.applyMcpImport).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("checkbox", { name: "Import gh" }));
  expect(within(dialog).queryByLabelText("Value for mcp/gh-2")).toBeNull();
  await user.click(within(dialog).getByRole("checkbox", { name: "Import git" }));
  expect((within(dialog).getByRole("button", { name: "Import 0 servers" }) as HTMLButtonElement).disabled).toBe(true);
});

test("a pick that failed is shown with the daemon's reason, and the rest are still added", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.applyMcpImport.mockResolvedValue({ added: [{ name: "git", state: "running", command: "x" }], failed: [{ key: "b", error: "gh-2 is already in use" }] } as never);
  const dialog = await openImport(fake, user);
  await user.click(await within(dialog).findByRole("button", { name: "Import 2 servers" }));
  expect((await screen.findByRole("alert")).textContent).toContain("gh-2 is already in use");
  expect(screen.getByText("git · running")).toBeTruthy();
});

test("a refused import keeps the dialog and shows the message", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.applyMcpImport.mockRejectedValue(new Error("the scan expired"));
  const dialog = await openImport(fake, user);
  await user.click(await within(dialog).findByRole("button", { name: "Import 2 servers" }));
  expect((await within(dialog).findByRole("alert")).textContent).toContain("the scan expired");
});

test("Import with nothing found, and a scan that fails, say so", async () => {
  const first = mount("/settings/mcp", [git]);
  const dialog = await openImport(first.fake, first.user, { scan_id: "s", sources: [] });
  expect(await within(dialog).findByText("No config files of other apps were found.")).toBeTruthy();
  first.unmount();
  const second = mount("/settings/mcp", [git]);
  second.fake.raw.scanMcpImport.mockRejectedValue(new Error("daemon is down"));
  await second.user.click(await screen.findByRole("button", { name: "Import" }));
  expect((await screen.findByRole("alert")).textContent).toContain("daemon is down");
  second.fake.raw.scanMcpImport.mockResolvedValue({ scan_id: "s", sources: [] });
  await second.user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No config files of other apps were found.")).toBeTruthy();
});

test("pasted JSON is read by the daemon alone, and a session adds its project's files", async () => {
  const { fake, user } = mount("/settings/mcp", [git], "s1");
  const dialog = await openImport(fake, user);
  expect(fake.raw.scanMcpImport).toHaveBeenCalledWith({ sessionId: "s1" });
  await user.click(within(dialog).getByText("Paste JSON or choose a file"));
  await user.click(within(dialog).getByLabelText("JSON"));
  await user.paste('{"mcpServers": {"x": {"command": "x"}}}');
  await user.click(within(dialog).getByRole("button", { name: "Read it" }));
  await waitFor(() => expect(fake.raw.scanMcpImport).toHaveBeenLastCalledWith({ sessionId: "s1", text: '{"mcpServers": {"x": {"command": "x"}}}' }));
});

test("axe finds nothing on the import dialog, in both themes", async () => {
  for (const theme of ["slip", "kiln"]) {
    const { fake, user, unmount } = mount("/settings/mcp", [git]);
    document.documentElement.dataset.theme = theme;
    const dialog = await openImport(fake, user);
    await within(dialog).findByText("3 servers in 1 place");
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    unmount();
  }
});

const TOML = '[mcp.git]\ncommand = "uvx"\nargs = ["mcp-server-git"]\n';

function fileOf(text: string, mtime = 100) {
  return { exists: true, mtime_ns: mtime, path: "/Users/me/.golem/config.toml", text };
}

function mountConfig(text = TOML, session: string | null = null, file: ReturnType<typeof fileOf> = fileOf(text)) {
  return mount("/settings/config", [], session, false, (fake) => fake.raw.configRawGet.mockResolvedValue(file));
}
const configBox = () => screen.findByRole("textbox", { name: "Config file text" });

test("Config file shows the file as text, with its path, and says there are no changes", async () => {
  const { fake } = mountConfig();
  const box = (await configBox()) as HTMLTextAreaElement;
  expect(box.value).toBe(TOML);
  expect(screen.getByText("/Users/me/.golem/config.toml")).toBeTruthy();
  expect(screen.getByText("no changes")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fake.raw.configRawGet).toHaveBeenCalledWith({ scope: "user" });
});

test("typing asks the daemon to check the text after a pause, writing nothing, and a good text is valid", async () => {
  const { fake, user } = mountConfig();
  const box = await configBox();
  await user.type(box, "# hi");
  expect(screen.getByText("checking…")).toBeTruthy();
  await waitFor(() => expect(fake.raw.configRawSet).toHaveBeenCalled());
  expect(fake.raw.configRawSet.mock.calls.at(-1)![0]).toMatchObject({ text: `${TOML}# hi`, baseMtimeNs: 100, scope: "user", dryRun: true });
  expect(await screen.findByText("✔ valid")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(false);
});

test("a problem is listed with its line, marks the gutter, and keeps Review off", async () => {
  const { fake, user } = mountConfig();
  fake.raw.configRawSet.mockResolvedValue({ ok: false, errors: [{ line: 2, column: 11, path: "mcp.git.command", message: "not a command" }] });
  const box = await configBox();
  await user.type(box, "x");
  expect(await screen.findByText("1 problem")).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Problems" })).getByText("line 2:11: not a command (mcp.git.command)")).toBeTruthy();
  expect(screen.getByText("✘2")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(true);
});

test("Review shows what changes as a diff, and Save writes with the file's mtime, then reloads and says saved", async () => {
  const { fake, user } = mountConfig();
  const box = await configBox();
  await user.clear(box);
  await user.click(box);
  await user.paste('[mcp.git]\ncommand = "git-mcp"\nargs = ["mcp-server-git"]\n');
  await screen.findByText("✔ valid");
  fake.raw.configRawGet.mockResolvedValue(fileOf('[mcp.git]\ncommand = "git-mcp"\nargs = ["mcp-server-git"]\n', 200));
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Save /Users/me/.golem/config.toml?")).toBeTruthy();
  expect(within(dialog).getByText('command = "git-mcp"')).toBeTruthy();
  expect(within(dialog).getByText('command = "uvx"')).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Saved.")).toBeTruthy();
  const last = fake.raw.configRawSet.mock.calls.at(-1)![0];
  expect(last).toMatchObject({ baseMtimeNs: 100, scope: "user", dryRun: false });
  expect(((await screen.findByRole("textbox", { name: "Config file text" })) as HTMLTextAreaElement).value).toContain("git-mcp");
});

test("a save that needs a restart says which settings and gives the command", async () => {
  const { fake, user } = mountConfig();
  fake.raw.configRawSet.mockResolvedValue({ ok: true, mtime_ns: 3, restart_needed: ["ollama"] });
  const box = await configBox();
  await user.type(box, "# x");
  await screen.findByText("Saving changes settings that are read only when the daemon starts: ollama.");
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
  const status = (await screen.findByText(/Saved\./)).closest("div") as HTMLElement;
  expect(status.textContent).toContain("read only when the daemon starts: ollama");
  expect(within(status).getByText("golem daemon restart")).toBeTruthy();
});

test("a file that changed on disk offers Reload or Keep editing, and Reload drops the edits", async () => {
  const { fake, user } = mountConfig();
  const box = await configBox();
  await user.type(box, "# mine");
  await screen.findByText("✔ valid");
  fake.raw.configRawSet.mockResolvedValue({ ok: false, errors: [{ message: "config.toml changed on disk since it was read" }] });
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("The file changed on disk");
  fake.raw.configRawGet.mockResolvedValue(fileOf("[mcp.other]\ncommand = \"x\"\n", 300));
  await user.click(screen.getByRole("button", { name: "Reload the file" }));
  await waitFor(() => expect(((screen.getByRole("textbox", { name: "Config file text" })) as HTMLTextAreaElement).value).toContain("mcp.other"));
  expect(screen.queryByText(/changed on disk/)).toBeNull();
});

test("a refused save shows the daemon's message and Discard puts the text back", async () => {
  const { fake, user } = mountConfig();
  const box = (await configBox()) as HTMLTextAreaElement;
  await user.type(box, "# x");
  await screen.findByText("✔ valid");
  fake.raw.configRawSet.mockRejectedValue(new Error("the daemon is busy"));
  await user.click(screen.getByRole("button", { name: "Review changes" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("the daemon is busy");
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(box.value).toBe(TOML);
});

test("a file that cannot be read says so, with Retry; a missing one says saving creates it", async () => {
  const first = mount("/settings/config", [], null, false, (fake) => fake.raw.configRawGet.mockRejectedValue(new Error("no access")));
  expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain("no access");
  first.fake.raw.configRawGet.mockResolvedValue({ exists: false, path: "/Users/me/.golem/config.toml", text: "" });
  await first.user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText(/does not exist yet: saving creates it/)).toBeTruthy();
});

test("This project is off without a session, and with one it reads the project's file", async () => {
  const first = mountConfig();
  await configBox();
  expect((screen.getByRole("button", { name: "This project" }) as HTMLButtonElement).disabled).toBe(true);
  first.unmount();
  const { fake, user } = mountConfig(TOML, "s1");
  await configBox();
  fake.raw.configRawGet.mockResolvedValue({ exists: true, mtime_ns: 5, path: "/work/app/.golem/config.toml", text: "[mcp.db]\ncommand = \"db\"\n" });
  await user.click(screen.getByRole("button", { name: "This project" }));
  await waitFor(() => expect(fake.raw.configRawGet).toHaveBeenLastCalledWith({ scope: "project", sessionId: "s1" }));
  expect(((await screen.findByRole("textbox", { name: "Config file text" })) as HTMLTextAreaElement).value).toContain("mcp.db");
  expect(screen.getByRole("button", { name: "This project" }).getAttribute("aria-pressed")).toBe("true");
});

test("axe finds nothing on the config editor, with a problem and the diff, in both themes", async () => {
  for (const theme of ["slip", "kiln"]) {
    const { user, unmount } = mountConfig(TOML, "s1");
    document.documentElement.dataset.theme = theme;
    const box = await configBox();
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    await user.type(box, "# x");
    await screen.findByText("✔ valid");
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByRole("dialog");
    expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
    unmount();
  }
});
