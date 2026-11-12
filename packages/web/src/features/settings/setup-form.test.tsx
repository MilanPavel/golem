import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { ModelListResult, SetupRow } from "../../store/models.ts";
import { createPage } from "../../store/page.ts";
import { createPageHost } from "../../store/page-host.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, OLLAMA_FAILED_CODE, rpcError } from "../../store/test-support.ts";
import { closeModelDialog } from "../models/index.ts";
import { OK_ROWS, STATUS_ROWS, WORKING_LISTING } from "../setup/sample.ts";
import { TOOLS_CATALOG } from "../setup/tools-sample.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

const TWO_READY: ModelListResult = {
  ...WORKING_LISTING,
  models: WORKING_LISTING.models.map((each, index) =>
    index < 2 ? { ...each, status: "ready" as const, source: "installed" as const } : each,
  ),
};

function mount(rows: SetupRow[] = OK_ROWS, listing: ModelListResult = WORKING_LISTING, path = "/settings", pageKept?: boolean) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(listing);
  fake.raw.setupStatus.mockResolvedValue({ rows });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const pageHost = createPageHost(async () => (pageKept === undefined ? {} : { kept: pageKept }));
  const page = createPage(fake.client, { frame: fakeFrame(), doc, pageHost });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  const user = userEvent.setup();
  // user-event puts a clipboard of its own on the page; the tests want to see what is written.
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return { fake, page, user, ...view };
}

const cards = () => within(screen.getByRole("list", { name: "Setup" }));
const card = (name: string) => {
  const found = within(screen.getByRole("list", { name: "Setup" }))
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(name, { selector: "p" }) !== null);
  if (found === undefined) throw new Error(`no card named ${name}`);
  return within(found);
};

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  writeText = vi.fn(async () => undefined);
});
afterEach(() => {
  closeModelDialog();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("a setup that works: a card for each part with its word, and nothing to fix", async () => {
  mount(OK_ROWS);
  await screen.findByText("all set", { selector: "p" });
  const names = within(screen.getByRole("list", { name: "Setup" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent);
  expect(names).toEqual(["Service", "Ollama", "Model", "Tools", "Disk"]);
  expect(card("Ollama").getByText("done:")).toBeTruthy();
  expect(card("Model").getByText("Gemma 4 E4B · default")).toBeTruthy();
  expect(card("Tools").getByText("1 MCP server")).toBeTruthy();
  expect(card("Disk").queryByRole("button")).toBeNull();
  // The service is kept, and the daemon's own row is the page's: only the version is added.
  expect(card("Service").getByText(/running · v0\.5\.0 · starts at login/)).toBeTruthy();
});

const cardNames = () =>
  within(screen.getByRole("list", { name: "Setup" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent);

test("a page kept running by a job: a Web page card after Service, no command", async () => {
  mount(OK_ROWS, WORKING_LISTING, "/settings", true);
  const web = await waitFor(() => card("Web page"));
  expect(web.getByText("kept running · starts at login")).toBeTruthy();
  expect(web.getByText("done:")).toBeTruthy();
  expect(web.queryByRole("button")).toBeNull();
  expect(cardNames().slice(0, 2)).toEqual(["Service", "Web page"]);
});

test("a page run by hand: the card says so and copies golem web install when the service is kept", async () => {
  const { user } = mount(OK_ROWS, WORKING_LISTING, "/settings", false);
  const web = await waitFor(() => card("Web page"));
  expect(web.getByText("runs only while a terminal runs golem web")).toBeTruthy();
  expect(web.getByText("needs attention:")).toBeTruthy();
  expect(web.getByText("golem web install")).toBeTruthy();
  // Nothing about the setup rows can change by looking again.
  expect(web.queryByRole("button", { name: "Check again" })).toBeNull();
  await user.click(web.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("golem web install");
});

test("when neither job is kept both the Service and Web page cards name golem install", async () => {
  const rows = OK_ROWS.map((row) => (row.part === "service" ? { ...row, state: "warn" as const } : row));
  mount(rows, WORKING_LISTING, "/settings", false);
  const web = await waitFor(() => card("Web page"));
  expect(web.getByText("golem install")).toBeTruthy();
  expect(card("Service").getByText("golem install")).toBeTruthy();
});

test("a service not kept while the page is kept keeps its own command", async () => {
  const rows = OK_ROWS.map((row) => (row.part === "service" ? { ...row, state: "warn" as const } : row));
  mount(rows, WORKING_LISTING, "/settings", true);
  await waitFor(() => card("Web page"));
  expect(card("Service").getByText("golem install")).toBeTruthy();
});

test("an unknown page host has no Web page card", async () => {
  mount(OK_ROWS);
  await screen.findByText("all set", { selector: "p" });
  expect(cardNames()).not.toContain("Web page");
});

test.each(["slip", "kiln"])("the Web page card has no axe violations in %s", async (theme) => {
  document.documentElement.dataset.theme = theme;
  mount(OK_ROWS, WORKING_LISTING, "/settings", false);
  await waitFor(() => card("Web page"));
  expect((await axe.run(document.body, noContrast)).violations).toEqual([]);
});

test("Open setup is gone from Settings", async () => {
  mount(OK_ROWS);
  await screen.findByRole("list", { name: "Setup" });
  expect(screen.queryByRole("button", { name: "Open setup" })).toBeNull();
});

test("with Ollama missing and no model: Install Ollama, Pick a model…, and the problem in the status line", async () => {
  mount(STATUS_ROWS);
  expect(await screen.findByText("Ollama: Ollama is not installed", { selector: "p" })).toBeTruthy();
  expect(card("Ollama").getByText("failed:")).toBeTruthy();
  expect(card("Ollama").getByRole("button", { name: "Install Ollama" })).toBeTruthy();
  expect(card("Model").getByText("needs attention:")).toBeTruthy();
  expect(card("Model").getByRole("button", { name: "Pick a model…" })).toBeTruthy();
});

test("a service that is not kept shows the command with Copy, and Copy writes it", async () => {
  const rows = OK_ROWS.map((row) => (row.part === "service" ? { ...row, state: "warn" as const } : row));
  const { user } = mount(rows);
  const service = await waitFor(() => card("Service"));
  await waitFor(() => expect(service.getByText("golem install")).toBeTruthy());
  await user.click(service.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("golem install");
  await service.findByRole("button", { name: "Copied" });
});

test("Check again looks at the machine again: the listing and the rows", async () => {
  const rows = OK_ROWS.map((row) => (row.part === "service" ? { ...row, state: "warn" as const } : row));
  const { fake, user } = mount(rows);
  const service = await waitFor(() => card("Service"));
  await waitFor(() => expect(service.getByRole("button", { name: "Check again" })).toBeTruthy());
  await waitFor(() => expect(fake.raw.setupStatus).toHaveBeenCalled());
  const before = fake.raw.setupStatus.mock.calls.length;
  const listed = fake.raw.listModels.mock.calls.length;
  await user.click(service.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(fake.raw.setupStatus.mock.calls.length).toBeGreaterThan(before));
  await waitFor(() => expect(fake.raw.listModels.mock.calls.length).toBeGreaterThan(listed));
  expect(fake.raw.listModels).toHaveBeenLastCalledWith(true, false);
});

test("Change… opens the model dialog in default mode: Make default is the main button, and there is no session to use it for", async () => {
  const { fake, user } = mount(OK_ROWS, TWO_READY);
  const change = await within(await screen.findByRole("list", { name: "Setup" })).findByRole("button", { name: "Change…" });
  await user.click(change);
  const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  expect(within(dialog).getByText(/New sessions use ollama\/gemma4:e4b\./)).toBeTruthy();
  await user.click(within(dialog).getByRole("option", { name: /qwen3:8b/ }));
  const actions = within(dialog).getByRole("group", { name: /^Actions for/ });
  expect(within(actions).queryByRole("button", { name: /^Use for/ })).toBeNull();
  const make = within(actions).getByRole("button", { name: "Make default" });
  expect(make.className).toContain("bg-ink");
  fake.raw.setupStatus.mockResolvedValue({
    rows: OK_ROWS.map((row) => (row.part === "model" ? { ...row, detail: "Qwen3 8B · default" } : row)),
  });
  await user.click(make);
  expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/qwen3:8b");
  // The dialog stays open for the person to close, and the Model card shows the new default behind it.
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a model" })).toBeNull());
  await waitFor(() => expect(card("Model").getByText("Qwen3 8B · default")).toBeTruthy());
  await waitFor(() => expect(document.activeElement).toBe(change));
});

test("Enter on a model in default mode makes it the default", async () => {
  const { fake, user } = mount(OK_ROWS, TWO_READY);
  await user.click(await within(await screen.findByRole("list", { name: "Setup" })).findByRole("button", { name: "Change…" }));
  const dialog = await screen.findByRole("dialog", { name: "Choose a model" });
  await user.click(within(dialog).getByRole("option", { name: /qwen3:8b/ }));
  await user.type(within(dialog).getByRole("combobox", { name: "Search models" }), "{Enter}");
  await waitFor(() => expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/qwen3:8b"));
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
});

test("Install Ollama streams its output under the row, folds it when done, and the Engine row turns ok", async () => {
  const { fake, user } = mount(STATUS_ROWS);
  const ollama = await waitFor(() => card("Ollama"));
  await user.click(await ollama.findByRole("button", { name: "Install Ollama" }));
  expect(fake.raw.installOllama).toHaveBeenCalledTimes(1);
  await ollama.findByText("Installing Ollama…");
  act(() => fake.emitInstall({ kind: "output", text: "==> Downloading ollama\n==> Pouring ollama-0.12\r==> Pouring 50%\n" }));
  const output = await ollama.findByText(/Pouring 50%/);
  expect(output.textContent).toBe("==> Downloading ollama\n==> Pouring 50%");
  const details = output.closest("details");
  expect(details?.open).toBe(true);
  expect(ollama.getByRole("button", { name: "Cancel install" })).toBeTruthy();

  fake.raw.setupStatus.mockResolvedValue({
    rows: STATUS_ROWS.map((row) => (row.part === "engine" ? { ...row, state: "ok" as const, detail: "Ollama 0.12 · running", action: undefined } : row)),
  });
  act(() => fake.emitInstall({ kind: "done", done: { outcome: "installed" } }));
  await waitFor(() => expect(fake.raw.startOllama).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(card("Ollama").getByText("Ollama 0.12 · running")).toBeTruthy());
  expect(card("Ollama").getByText("done:")).toBeTruthy();
  expect(card("Ollama").queryByRole("button", { name: "Install Ollama" })).toBeNull();
  // The output stays for reading, folded.
  expect(card("Ollama").getByText(/Pouring 50%/).closest("details")?.open).toBe(false);
});

test("Cancel install stops it, and a stopped install leaves the button", async () => {
  const { fake, user } = mount(STATUS_ROWS);
  const ollama = await waitFor(() => card("Ollama"));
  await user.click(await ollama.findByRole("button", { name: "Install Ollama" }));
  await user.click(await ollama.findByRole("button", { name: "Cancel install" }));
  expect(fake.raw.cancelOllamaInstall).toHaveBeenCalledTimes(1);
  act(() => fake.emitInstall({ kind: "done", done: { outcome: "stopped" } }));
  await ollama.findByRole("button", { name: "Install Ollama" });
  expect(ollama.queryByRole("alert")).toBeNull();
});

test("a failed install is a red line in the Engine card, and the button is back to try again", async () => {
  const { fake, user } = mount(STATUS_ROWS);
  const ollama = await waitFor(() => card("Ollama"));
  await user.click(await ollama.findByRole("button", { name: "Install Ollama" }));
  act(() => fake.emitInstall({ kind: "done", done: { outcome: "failed", reason: "Error: no space left" } }));
  expect((await ollama.findByRole("alert")).textContent).toBe("Error: no space left");
  expect(ollama.getByRole("button", { name: "Install Ollama" })).toBeTruthy();
  expect(card("Model").queryByRole("alert")).toBeNull();
});

test("with no Homebrew the row links ollama.com/download in a new tab, with Check again, and opens nothing by itself", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const { fake, user } = mount(STATUS_ROWS);
  fake.raw.installOllama.mockRejectedValue(rpcError(OLLAMA_FAILED_CODE, "no Homebrew", { no_brew: true }));
  const ollama = await waitFor(() => card("Ollama"));
  await user.click(await ollama.findByRole("button", { name: "Install Ollama" }));
  const link = await ollama.findByRole("link", { name: /Download Ollama/ });
  expect(link.getAttribute("href")).toBe("https://ollama.com/download");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(ollama.getByRole("button", { name: "Check again" })).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});

test("Start Ollama starts it and looks again, and a refusal is a red line in the card", async () => {
  const rows = STATUS_ROWS.map((row) =>
    row.part === "engine" ? { ...row, state: "ok" as const, detail: "installed, not running, golem starts it", action: "start_ollama" as const } : row,
  );
  const { fake, user } = mount(rows);
  const ollama = await waitFor(() => card("Ollama"));
  fake.raw.startOllama.mockResolvedValueOnce({ running: false });
  await user.click(await ollama.findByRole("button", { name: "Start Ollama" }));
  expect((await ollama.findByRole("alert")).textContent).toBe("Ollama didn't start");
  await user.click(ollama.getByRole("button", { name: "Start Ollama" }));
  await waitFor(() => expect(fake.raw.startOllama).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(ollama.queryByRole("alert")).toBeNull());
});

test("a provider that needs a key: the command to copy for it, and Check again", async () => {
  const rows: SetupRow[] = [
    ...OK_ROWS.slice(0, 3),
    { part: "engine", name: "openai", state: "fail", detail: "no API key", action: "set_key", target: "openai" },
    ...OK_ROWS.slice(3),
  ];
  const { user } = mount(rows);
  const openai = await waitFor(() => card("OpenAI"));
  expect(openai.getByText("golem auth set openai")).toBeTruthy();
  await user.click(openai.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("golem auth set openai");
  expect(openai.getByRole("button", { name: "Check again" })).toBeTruthy();
});

const KEYED_LISTING: ModelListResult = { ...WORKING_LISTING, setup: { ...WORKING_LISTING.setup, keys: ["openai"] } };

test("API keys lists every provider, says which has a key saved, and offers the first without one", async () => {
  const { user } = mount(OK_ROWS, KEYED_LISTING);
  const section = await screen.findByRole("group", { name: "API keys" });
  const rows = within(within(section).getByRole("list", { name: "Saved keys" })).getAllByRole("listitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    "AnthropicClaudeno key",
    "OpenAIGPTdone: key saved",
    "GoogleGeminino key",
    "DeepSeekDeepSeek V3 and R1no key",
    "xAIGrokno key",
    "MoonshotKimino key",
  ]);
  const select = within(section).getByRole("combobox", { name: "Provider" });
  expect((select as HTMLSelectElement).value).toBe("anthropic");
  expect(within(select).getByRole("option", { name: "OpenAI · key saved" })).toBeTruthy();
  expect(within(section).getByText("golem auth set anthropic")).toBeTruthy();
  await user.selectOptions(select, "openai");
  expect(within(section).getByText("golem auth set openai")).toBeTruthy();
  expect(within(section).getByText(/to replace the saved one/)).toBeTruthy();
  await user.click(within(section).getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("golem auth set openai");
});

test("a key saved from the terminal shows after Check again", async () => {
  const { fake, user } = mount(OK_ROWS, WORKING_LISTING);
  const section = await screen.findByRole("group", { name: "API keys" });
  expect(within(section).queryByText("key saved")).toBeNull();
  fake.raw.listModels.mockResolvedValue(KEYED_LISTING);
  await user.click(within(section).getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(within(section).getByText("key saved")).toBeTruthy());
});

test("API keys never asks for a key itself", async () => {
  mount(OK_ROWS);
  const section = await screen.findByRole("group", { name: "API keys" });
  expect(section.querySelector("input")).toBeNull();
  expect(document.querySelector("input[type=password]")).toBeNull();
});

test("Run setup again goes to /welcome, and there is no setup dialog", async () => {
  const { user } = mount(OK_ROWS);
  await user.click(await screen.findByRole("button", { name: "Run setup again" }));
  await screen.findByRole("heading", { level: 1, name: "Welcome to golem" });
  expect(location.pathname).toBe("/welcome");
  expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
});

test("with no server yet, Add tools opens the offer in place; the servers added show as done, and then Manage links to the MCP section", async () => {
  const { fake, user } = mount([...OK_ROWS.filter((row) => row.part !== "tools")]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: TOOLS_CATALOG.map((each) => (each.id === "fetch" ? { ...each, added: true } : each)) });
  const tools = await waitFor(() => card("Tools"));
  expect(tools.getByText("no MCP servers yet")).toBeTruthy();
  expect(tools.queryByRole("link")).toBeNull();
  await user.click(tools.getByRole("button", { name: "Add tools" }));
  const panel = within(await screen.findByRole("group", { name: "Add tools" }));
  // A server that is there already is shown as done and cannot be ticked.
  const fetch = panel.getByRole("checkbox", { name: /^Fetch/ }) as HTMLInputElement;
  expect(fetch.checked).toBe(true);
  expect(fetch.disabled).toBe(true);
  expect(panel.getByRole("heading", { name: "Tools · 1 server" })).toBeTruthy();
  expect(panel.getByRole("button", { name: "Add 2" })).toBeTruthy();
  // Settings keeps the row at the start; only /welcome centers it.
  expect(panel.getByRole("button", { name: "Add 2" }).parentElement?.className).not.toContain("justify-center");
  expect(document.querySelector("input[type=password]")).toBeNull();
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  await user.click(panel.getByRole("checkbox", { name: /^Playwright/ }));
  await user.click(panel.getByRole("button", { name: "Add 1" }));
  await waitFor(() => expect(fake.raw.addMcpServer).toHaveBeenCalledWith(expect.objectContaining({ catalog_id: "context7" })));
  await waitFor(() => expect(panel.getAllByText(/^added · /).length).toBe(1));
  await waitFor(() => expect(card("Tools").getByRole("link", { name: "Manage" }).getAttribute("href")).toBe("/settings/mcp"));
  await user.click(panel.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("group", { name: "Add tools" })).toBeNull();
});

test("Cancel closes the offer in place and adds nothing", async () => {
  const { fake, user } = mount([...OK_ROWS.filter((row) => row.part !== "tools")]);
  fake.raw.mcpCatalog.mockResolvedValue({ entries: TOOLS_CATALOG });
  await user.click((await waitFor(() => card("Tools"))).getByRole("button", { name: "Add tools" }));
  const panel = within(await screen.findByRole("group", { name: "Add tools" }));
  await user.click(panel.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: "Add tools" })).toBeNull();
  expect(fake.raw.addMcpServer).not.toHaveBeenCalled();
});

test("a failed setup.status says so, with a way to try again", async () => {
  history.replaceState(null, "", "/settings");
  const fake = fakeClient();
  fake.raw.setupStatus.mockRejectedValue(new Error("no status"));
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  const user = userEvent.setup();
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain("Could not read the setup");
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("list", { name: "Setup" });
}, 10_000);

for (const theme of ["slip", "kiln"] as const) {
  test(`no accessibility violations on the form with problems and while installing, in ${theme}`, async () => {
    const { container, fake, user } = mount(STATUS_ROWS);
    document.documentElement.dataset.theme = theme;
    const ollama = await waitFor(() => card("Ollama"));
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    await user.click(await ollama.findByRole("button", { name: "Install Ollama" }));
    act(() => fake.emitInstall({ kind: "output", text: "==> Downloading ollama\n" }));
    await ollama.findByText(/Downloading ollama/);
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  });
}

test("cards is the list of the form", async () => {
  mount(OK_ROWS);
  await screen.findByRole("list", { name: "Setup" });
  expect(cards().getAllByRole("listitem").length).toBe(5);
});
