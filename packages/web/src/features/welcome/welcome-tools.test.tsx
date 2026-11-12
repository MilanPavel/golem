import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { McpTestResult } from "../../store/mcp.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { createPage } from "../../store/page.ts";
import { fakeClient, fakeFrame, rpcError } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { OK_ROWS, WORKING_LISTING } from "../setup/sample.ts";
import { startNoticeStore } from "../setup/start-notice.ts";
import { TOOLS_CATALOG } from "../setup/tools-sample.ts";
import { resetWelcome } from "./welcome-store.ts";

const REFUSED = "The token was refused (401). Check it has repo access.";
const SECRET = "ghp_secret_value_1234";

function result(extra: Partial<McpTestResult> = {}): McpTestResult {
  return { test_id: "t", ok: true, steps: [], tools: [], stderr_tail: [], ...extra };
}

function tools(count: number): McpTestResult["tools"] {
  return Array.from({ length: count }, (_, index) => ({ name: `tool${index}`, description: "", hidden: false, read_only: true, schema_tokens: 1 }));
}

/** A fresh home on its way through setup: a working model, no `[mcp]` table, and the starter catalog. */
function mount(path = "/welcome?step=tools") {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.listMcp.mockResolvedValue({ servers: [] });
  fake.raw.mcpCatalog.mockResolvedValue({ entries: TOOLS_CATALOG });
  fake.raw.mcpTest.mockImplementation(async (params) => {
    const name = "name" in params && params.name !== undefined ? params.name : "";
    return result({ tools: tools(name === "context7" ? 2 : 1) });
  });
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
  return { fake, user: userEvent.setup(), ...view };
}

const offer = () => screen.findByRole("list", { name: "Starter tools" });
const box = (name: string) => screen.getByRole("checkbox", { name: new RegExp(`^${name}`) }) as HTMLInputElement;
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const added = (fake: ReturnType<typeof mount>["fake"]) => fake.raw.addMcpServer.mock.calls.map(([params]) => params.catalog_id);
const tokenField = () => document.querySelector<HTMLInputElement>("input[type=password]");

beforeEach(() => {
  localStorage.clear();
  resetWelcome();
});
afterEach(() => {
  startNoticeStore.set(null);
  closePalette();
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
});

test("a fresh home offers the starters: the three that need no secret ticked, and Add 3", async () => {
  mount();
  await offer();
  expect(screen.getByRole("heading", { level: 2, name: "Give golem some tools?" })).toBeTruthy();
  expect(screen.getByText("They cost nothing until a chat turns one on. You can add more in Settings.")).toBeTruthy();
  expect(["Fetch", "Context7", "Playwright", "GitHub"].map((name) => box(name).checked)).toEqual([true, true, true, false]);
  // What each needs shows before the click.
  expect(screen.getByText("needs Node · installed for you")).toBeTruthy();
  expect(screen.getByText("needs a token")).toBeTruthy();
  expect(button("Add 3")).toBeTruthy();
  expect(tokenField()).toBeNull();
  // The action row is centered like every other step's.
  expect(button("Add 3").parentElement?.className).toContain("justify-center");
});

test("ticking changes the count, and GitHub opens a password field that is empty and goes when it is unticked", async () => {
  const { user } = mount();
  await offer();
  await user.click(box("Fetch"));
  expect(button("Add 2")).toBeTruthy();
  await user.click(box("Fetch"));
  await user.click(box("GitHub"));
  // GitHub counts once it has a token, not while its field is empty.
  expect(button("Add 3")).toBeTruthy();
  const field = tokenField();
  expect(field?.type).toBe("password");
  expect(field?.value).toBe("");
  expect(field?.getAttribute("autocomplete")).toBe("off");
  await user.type(field as HTMLInputElement, "x");
  expect(button("Add 4")).toBeTruthy();
  await user.clear(field as HTMLInputElement);
  expect(button("Add 3")).toBeTruthy();
  expect(screen.getByText(/Stored in your macOS Keychain, never in a file\. Empty skips GitHub\./)).toBeTruthy();
  await user.click(box("GitHub"));
  expect(tokenField()).toBeNull();
  expect(button("Add 3")).toBeTruthy();
});

test("only GitHub ticked with an empty token: nothing is addable, so Add is disabled until a token is typed", async () => {
  const { user } = mount();
  await offer();
  for (const name of ["Fetch", "Context7", "Playwright"]) await user.click(box(name));
  await user.click(box("GitHub"));
  expect((button("Add") as HTMLButtonElement).disabled).toBe(true);
  await user.type(tokenField() as HTMLInputElement, "x");
  expect((button("Add 1") as HTMLButtonElement).disabled).toBe(false);
  await user.clear(tokenField() as HTMLInputElement);
  expect((button("Add") as HTMLButtonElement).disabled).toBe(true);
});

test("the Add count and the Adding heading agree when a token is typed", async () => {
  const { user } = mount();
  await offer();
  await user.click(box("GitHub"));
  await user.type(tokenField() as HTMLInputElement, "x");
  await user.click(button("Add 4"));
  await screen.findByRole("heading", { level: 2, name: "Adding 4 tools" });
});

test("Skip adds nothing and goes to Ready, where Tools says skipped", async () => {
  const { fake, user } = mount();
  await offer();
  await user.click(button("Skip"));
  await screen.findByRole("heading", { level: 2, name: "golem is ready." });
  expect(fake.raw.addMcpServer).not.toHaveBeenCalled();
  expect(screen.getByRole("list", { name: "What was set up" }).textContent).toContain("skipped");
});

test("Add 3 adds the three starters one at a time, Node first for the one that needs it, and Ready lists them", async () => {
  const { fake, user } = mount();
  await offer();
  await user.click(button("Add 3"));
  await screen.findByRole("heading", { level: 2, name: "Adding 3 tools" });
  // Fetch and Context7 go in; Playwright waits for Node, which is installed first.
  await waitFor(() => expect(fake.raw.installRuntime).toHaveBeenCalledWith("node"));
  expect(added(fake)).toEqual(["fetch", "context7"]);
  const cards = within(screen.getByRole("list", { name: "Tools being added" }));
  expect(cards.getByText("added · 1 tool · on demand")).toBeTruthy();
  expect(cards.getByText("added · 2 tools · on demand")).toBeTruthy();
  expect(cards.getByText("installing Node")).toBeTruthy();
  act(() => fake.emitRuntime({ kind: "output", name: "node", text: "######## 41.0%\n" }));
  expect((await cards.findByRole("progressbar", { name: "Installing Node" })).getAttribute("aria-valuenow")).toBe("41");
  act(() => fake.emitRuntime({ kind: "done", done: { name: "node", ok: true } }));
  await waitFor(() => expect(added(fake)).toEqual(["fetch", "context7", "playwright"]));
  await waitFor(() => expect(cards.getAllByText(/^added · /)).toHaveLength(3));
  for (const [params] of fake.raw.addMcpServer.mock.calls) expect(params.name).toBe(params.catalog_id);
  await userEvent.setup().click(button("Continue"));
  await screen.findByRole("heading", { level: 2, name: "golem is ready." });
  expect(screen.getByRole("list", { name: "What was set up" }).textContent).toContain("Fetch, Context7, Playwright · on demand");
});

test("Continue is there while Node still installs; the row finishes in the background and Ready says so", async () => {
  const { fake, user } = mount();
  await offer();
  await user.click(button("Add 3"));
  await waitFor(() => expect(fake.raw.installRuntime).toHaveBeenCalledWith("node"));
  expect(screen.getByText("Node keeps installing if you go on.")).toBeTruthy();
  expect(button("Continue").parentElement?.className).toContain("justify-center");
  await user.click(button("Continue"));
  await screen.findByRole("heading", { level: 2, name: "golem is ready." });
  const line = screen.getByRole("list", { name: "What was set up" }).textContent ?? "";
  expect(line).toContain("Fetch, Context7 · on demand");
  expect(line).toContain("Playwright still adding");
});

test("a Node install that fails fails its row with the reason, and the others stay added", async () => {
  const { fake, user } = mount();
  await offer();
  await user.click(button("Add 3"));
  await waitFor(() => expect(fake.raw.installRuntime).toHaveBeenCalledWith("node"));
  act(() => fake.emitRuntime({ kind: "done", done: { name: "node", ok: false, error: "brew is not installed" } }));
  expect(await screen.findByText("failed · brew is not installed")).toBeTruthy();
  expect(added(fake)).toEqual(["fetch", "context7"]);
  expect(button("Continue")).toBeTruthy();
});

test("GitHub: the token goes in the add, the field is empty after, and a failure shows the one hint with its three choices", async () => {
  const { fake, user } = mount();
  await offer();
  await user.click(box("Playwright"));
  await user.click(box("GitHub"));
  await user.type(tokenField() as HTMLInputElement, SECRET);
  fake.raw.mcpTest.mockImplementation(async (params) => {
    const name = "name" in params && params.name !== undefined ? params.name : "";
    return name === "github" ? result({ ok: false, hint: REFUSED }) : result({ tools: tools(1) });
  });
  await user.click(button("Add 3"));
  await screen.findByRole("heading", { level: 2, name: "Adding 3 tools" });
  await waitFor(() => expect(added(fake)).toContain("github"));
  const call = fake.raw.addMcpServer.mock.calls.find(([params]) => params.catalog_id === "github")?.[0];
  expect(call?.secrets).toEqual({ token: SECRET });
  expect(await screen.findByText(`failed · ${REFUSED}`)).toBeTruthy();
  // The token is nowhere on the page.
  expect(tokenField()).toBeNull();
  expect(document.body.textContent).not.toContain(SECRET);
  expect(screen.getByRole("button", { name: "Paste a new token" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show the log" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Skip GitHub" })).toBeTruthy();
  expect(button("Continue")).toBeTruthy();
});

test("Paste a new token replaces the failed server and tries again, and the field is empty afterwards", async () => {
  const { fake, user } = mount();
  await offer();
  await user.click(box("Playwright"));
  await user.click(box("GitHub"));
  await user.type(tokenField() as HTMLInputElement, "old-token");
  fake.raw.mcpTest.mockImplementation(async (params) => {
    const name = "name" in params && params.name !== undefined ? params.name : "";
    return name === "github" ? result({ ok: false, hint: REFUSED }) : result({ tools: tools(1) });
  });
  await user.click(button("Add 3"));
  await screen.findByText(`failed · ${REFUSED}`);
  fake.raw.mcpTest.mockImplementation(async () => result({ tools: tools(26) }));
  await user.click(button("Paste a new token"));
  const field = tokenField() as HTMLInputElement;
  expect(field.value).toBe("");
  await user.type(field, "new-token");
  await user.click(button("Try again"));
  expect(await screen.findByText("added · 26 tools · on demand")).toBeTruthy();
  // The old server went before the new add, so the name was free.
  expect(fake.raw.removeMcpServer).toHaveBeenCalledWith("github");
  const second = fake.raw.addMcpServer.mock.calls.filter(([params]) => params.catalog_id === "github").at(-1)?.[0];
  expect(second?.secrets).toEqual({ token: "new-token" });
  expect(tokenField()).toBeNull();
  expect(document.body.textContent).not.toContain("new-token");
});

test("Show the log reads mcp.logs of the failed server, and Skip drops it", async () => {
  const { fake, user } = mount();
  await offer();
  await user.click(box("Playwright"));
  await user.click(box("GitHub"));
  await user.type(tokenField() as HTMLInputElement, SECRET);
  fake.raw.mcpTest.mockImplementation(async (params) => {
    const name = "name" in params && params.name !== undefined ? params.name : "";
    return name === "github" ? result({ ok: false, hint: REFUSED }) : result({ tools: tools(1) });
  });
  fake.raw.mcpLogs.mockResolvedValue({ name: "github", lines: [{ ts: "2026-11-12T10:00:00+00:00", stream: "stderr", text: "401 Unauthorized" }] as never });
  await user.click(button("Add 3"));
  await screen.findByText(`failed · ${REFUSED}`);
  await user.click(button("Show the log"));
  expect(await screen.findByLabelText("GitHub log")).toBeTruthy();
  expect(fake.raw.mcpLogs).toHaveBeenCalledWith("github", {});
  await user.click(button("Skip GitHub"));
  expect(await screen.findByText("skipped")).toBeTruthy();
  expect(fake.raw.removeMcpServer).toHaveBeenCalledWith("github");
});

test("an add the daemon refuses fails its row with the daemon's reason", async () => {
  const { fake, user } = mount();
  await offer();
  fake.raw.addMcpServer.mockRejectedValueOnce(rpcError(-32602, "mcp server fetch already exists"));
  await user.click(button("Add 3"));
  expect(await screen.findByText("failed · mcp server fetch already exists")).toBeTruthy();
});

test("Tools is not offered when the config already has servers: Model goes straight to Ready", async () => {
  history.replaceState(null, "", "/welcome?step=model");
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.listMcp.mockResolvedValue({
    servers: [{ name: "git", state: "running", command: "git", tools: [], schema_tokens: 0, config: "/h/config.toml", on_demand: true, enabled: null }],
  });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 2, name: "Pick a model" });
  const stepper = screen.getByRole("list", { name: "Setup steps" });
  await waitFor(() => expect(within(stepper).getByText("skipped")).toBeTruthy());
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { level: 2, name: "golem is ready." });
});

test("with no servers, Model goes on to Tools", async () => {
  history.replaceState(null, "", "/welcome?step=model");
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.mcpCatalog.mockResolvedValue({ entries: TOOLS_CATALOG });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 2, name: "Pick a model" });
  await waitFor(() => expect(fake.raw.listMcp).toHaveBeenCalled());
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  expect(await offer()).toBeTruthy();
  expect(location.search).toBe("?step=tools");
});

test("the offer and the run have no accessibility violations", async () => {
  const { container, user } = mount();
  await offer();
  await user.click(box("GitHub"));
  const noContrast = { rules: { "color-contrast": { enabled: false } } };
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  // GitHub's token is empty, so it is not counted and three are added.
  await user.click(button("Add 3"));
  await screen.findByRole("heading", { level: 2, name: "Adding 3 tools" });
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});
