import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { McpServer, McpToolsResult } from "../../store/mcp.ts";
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

const GIT_ROW = /^running,\s*git(?!hub)/;
const DB_ROW = /^running,\s*db/;
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
      { name: "mcp__git__git_status", description: "Shows the status.\nMore.", schema_tokens: 300 },
      { name: "mcp__git__git_log", description: "Shows the log.", schema_tokens: 100, hidden: true },
    ],
  });
  await user.click(await screen.findByRole("button", { name: /git/ }));
  await user.click(screen.getByRole("button", { name: "View tools" }));
  const list = await screen.findByRole("list", { name: "git tools" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "showngit_status≈300 tokensShows the status.Try",
    "hiddengit_log≈100 tokensShows the log.Try",
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
  await user.click(screen.getByRole("button", { name: "View tools" }));
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
  await user.click(screen.getByRole("button", { name: "View tools" }));
  await user.click(await screen.findByRole("switch", { name: "Show git_log to the model" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not a hidden pattern");
  expect(fake.raw.updateMcpServer).not.toHaveBeenCalled();
});

test("Try a tool draws a form from its schema, sends typed arguments, and shows the result", async () => {
  const { fake, user } = mount("/settings/mcp", [git], "a");
  fake.raw.mcpCall.mockResolvedValue({ text: "commit 1\ncommit 2", is_error: false });
  await openTools(user, fake);
  await user.click(screen.getByRole("button", { name: "Try git_log" }));
  const dialog = screen.getByRole("dialog");
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
  const dialog = screen.getByRole("dialog");
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
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Run" }));
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
  await user.click(screen.getByRole("button", { name: "Test the connection" }));
  const steps = await screen.findByRole("list", { name: "Test steps" });
  expect(within(steps).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["✓ resolve 3 ms"]);
  expect(await screen.findByText(/ok: git 1.0, 1 tools/)).toBeTruthy();
  expect(fake.raw.mcpTest).toHaveBeenCalledWith({ name: "git" }, expect.any(Function));
  await user.click(screen.getByRole("button", { name: "Test again" }));
  await waitFor(() => expect(fake.raw.mcpTest).toHaveBeenCalledTimes(2));
});

test("a failed test shows what the server said and the hint, and a refused one shows the message", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.mcpTest.mockResolvedValue({ test_id: "t", ok: false, steps: [], tools: [], stderr_tail: ["boom"], hint: "Install Node." } as never);
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("button", { name: "Test the connection" }));
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
  await user.click(screen.getByRole("button", { name: "View the log" }));
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
  await user.click(screen.getByRole("button", { name: "View the log" }));
  expect(await screen.findByText("Nothing logged yet.")).toBeTruthy();
});

test("Remove asks first, names the file, and acts only on Remove; a project's server has no Remove", async () => {
  const { fake, user } = mount("/settings/mcp", [git, mine]);
  await user.click(await screen.findByRole("button", { name: DB_ROW }));
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Remove git?")).toBeTruthy();
  expect(within(dialog).getByText("/Users/me/.golem/config.toml")).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.removeMcpServer).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Remove" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));
  expect(fake.raw.removeMcpServer).toHaveBeenCalledWith("git");
});

test("a refused remove shows the daemon's message", async () => {
  const { fake, user } = mount("/settings/mcp", [git]);
  fake.raw.removeMcpServer.mockRejectedValue(new Error("not yours to remove"));
  await user.click(await screen.findByRole("button", { name: GIT_ROW }));
  await user.click(screen.getByRole("button", { name: "Remove" }));
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
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Test the connection" }));
    await screen.findByRole("status");
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "View the log" }));
    await screen.findByRole("log", { name: "git log" });
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    unmount();
  }
});
