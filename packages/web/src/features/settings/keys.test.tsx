import { focusManager } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { KEYS_KEY, type AuthListResult } from "../../store/keys.ts";
import type { McpCatalogEntry, McpServer } from "../../store/mcp.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };

const KEYS: AuthListResult = {
  providers: [
    { provider: "anthropic", takes_key: true, needs_key: true, source: "env", env_var: "ANTHROPIC_API_KEY" },
    { provider: "openai", takes_key: true, needs_key: true, source: "keychain", env_var: "OPENAI_API_KEY" },
    { provider: "openrouter", takes_key: true, needs_key: true, source: null, env_var: "OPENROUTER_API_KEY" },
    { provider: "google", takes_key: true, needs_key: true, source: null, env_var: "GOOGLE_API_KEY" },
    { provider: "ollama", takes_key: false, needs_key: false, source: null, env_var: null },
    { provider: "mcp/github", takes_key: true, needs_key: true, source: "keychain", env_var: null },
    { provider: "mcp/brave-search", takes_key: true, needs_key: true, source: null, env_var: "BRAVE_API_KEY" },
    { provider: "mcp/linear-oauth", takes_key: true, needs_key: true, source: null, env_var: null },
    { provider: "mcp/acme-api_key", takes_key: true, needs_key: true, source: "env", env_var: "ACME_KEY" },
  ],
};

const server = (name: string): McpServer => ({ name, state: "running", command: name, tools: [], schema_tokens: null, on_demand: false, enabled: null });
const SERVERS = ["github", "brave", "brave-search", "linear", "acme"].map(server);

function mount(keys: AuthListResult = KEYS, servers: readonly McpServer[] = SERVERS) {
  history.replaceState(null, "", "/settings/keys");
  const fake = fakeClient();
  fake.raw.listKeys.mockResolvedValue(keys);
  fake.raw.listMcp.mockResolvedValue({ servers: [...servers] });
  fake.raw.mcpCatalog.mockResolvedValue({ entries: [{ id: "github", name: "github", title: "GitHub" }] as unknown as McpCatalogEntry[] });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, user: userEvent.setup(), ...view };
}

const group = async (name: string) => within(await screen.findByRole("list", { name }));
type Group = Awaited<ReturnType<typeof group>>;
const rowOf = (list: Group, name: string) => within(list.getByText(name).closest("li") as HTMLElement);
const names = (list: Group) => list.getAllByRole("listitem").map((item) => item.querySelector("span.font-semibold")?.textContent);

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("the keys are two groups: the model providers that take a key, and every mcp ref", async () => {
  mount();
  const models = await group("Model providers");
  expect(models.getAllByRole("listitem")).toHaveLength(4);
  expect(screen.queryByText("ollama")).toBeNull();
  expect((await group("MCP servers")).getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getByText("for cloud models · optional when you run on Ollama")).toBeTruthy();
  expect(screen.getByText("tokens the tool servers sign in with")).toBeTruthy();
});

test("the head counts the saved keys in all, and each group in its own", async () => {
  mount();
  await screen.findByRole("list", { name: "Model providers" });
  expect(screen.getByText("4 of 8 saved")).toBeTruthy();
  expect(screen.getAllByText(/of 4 saved/)).toHaveLength(2);
});

test("saved rows come first in each group, then A to Z by display name", async () => {
  mount();
  expect(names(await group("Model providers"))).toEqual(["Anthropic", "OpenAI", "Google", "openrouter"]);
  expect(names(await group("MCP servers"))).toEqual(["acme", "GitHub", "brave-search", "linear"]);
});

test("a hosted provider shows its name and blurb, a custom one its id, and each row has a mark", async () => {
  mount();
  const models = await group("Model providers");
  const openai = rowOf(models, "OpenAI");
  expect(openai.getByText("GPT")).toBeTruthy();
  expect(openai.getByText("in the Keychain")).toBeTruthy();
  const custom = rowOf(models, "openrouter");
  expect(custom.getByText("custom · OpenAI-compatible")).toBeTruthy();
  expect(custom.getByText("not set")).toBeTruthy();
  for (const item of models.getAllByRole("listitem")) expect(item.querySelector("svg path, svg text")).not.toBeNull();
  expect(within(custom.getByText("custom · OpenAI-compatible").closest("li") as HTMLElement).queryByText("O")).not.toBeNull();
});

test("a missing key has the amber pill and the command with Copy; a saved one has neither", async () => {
  const { user } = mount();
  const models = await group("Model providers");
  const google = rowOf(models, "Google");
  expect(google.getByText("missing")).toBeTruthy();
  expect(google.getByText("golem auth set google").tagName).toBe("CODE");
  await user.click(google.getByRole("button", { name: /^Copy / }));
  const openai = rowOf(models, "OpenAI");
  expect(openai.getByText("saved")).toBeTruthy();
  expect(openai.queryByRole("button", { name: /^Copy / })).toBeNull();
  expect(openai.getByRole("button", { name: /Replace or remove/ }).getAttribute("aria-expanded")).toBe("false");
});

test("an mcp ref goes to the longest server name, with its blurb and the command that sets it", async () => {
  mount();
  const mcp = await group("MCP servers");
  const brave = rowOf(mcp, "brave-search");
  expect(brave.getByText("token")).toBeTruthy();
  expect(brave.getByText("golem auth set mcp/brave-search")).toBeTruthy();
  const oauth = rowOf(mcp, "linear");
  expect(oauth.getByText("OAuth sign-in")).toBeTruthy();
  expect(oauth.getByText("golem mcp login linear").tagName).toBe("CODE");
  const acme = rowOf(mcp, "acme");
  expect(acme.getByText("api_key input")).toBeTruthy();
  expect(acme.getByText("from $ACME_KEY")).toBeTruthy();
  // The title comes from the catalog when the server is in it.
  expect(rowOf(mcp, "GitHub").getByText("token")).toBeTruthy();
});

test("a key in the Keychain opens a drawer with Replace and Remove", async () => {
  const { user } = mount();
  const openai = rowOf(await group("Model providers"), "OpenAI");
  await user.click(openai.getByRole("button", { name: /Replace or remove/ }));
  expect(openai.getByText("golem auth set openai")).toBeTruthy();
  expect(openai.getByText("golem auth remove openai")).toBeTruthy();
  expect(openai.getByRole("button", { name: /Replace or remove/ }).getAttribute("aria-expanded")).toBe("true");
  await user.click(openai.getByRole("button", { name: /Replace or remove/ }));
  expect(openai.queryByText("golem auth remove openai")).toBeNull();
});

test("a key from the environment says where it is set, and has no Remove command", async () => {
  const { user } = mount();
  const anthropic = rowOf(await group("Model providers"), "Anthropic");
  expect(anthropic.getByText("from $ANTHROPIC_API_KEY")).toBeTruthy();
  await user.click(anthropic.getByRole("button", { name: /Replace or remove/ }));
  expect(anthropic.getByText("golem auth set anthropic")).toBeTruthy();
  expect(anthropic.getByText("$ANTHROPIC_API_KEY", { selector: "code" })).toBeTruthy();
  expect(anthropic.getByText(/in the daemon's environment\. Unset it there to remove\./)).toBeTruthy();
  expect(anthropic.queryByText(/golem auth remove/)).toBeNull();
});

test("the Server link opens that server on the MCP servers tab", async () => {
  const { user } = mount();
  const mcp = await group("MCP servers");
  await user.click(rowOf(mcp, "GitHub").getByRole("link", { name: "github on the MCP servers tab" }));
  expect(location.pathname).toBe("/settings/mcp");
  await screen.findByRole("heading", { name: "github" });
});

test("with no mcp ref there is a dashed box with a link to the MCP servers tab", async () => {
  const { user } = mount({ providers: KEYS.providers.filter((status) => !status.provider.startsWith("mcp/")) });
  await screen.findByRole("list", { name: "Model providers" });
  expect(screen.queryByRole("list", { name: "MCP servers" })).toBeNull();
  expect(screen.getByText(/No MCP server needs a key/)).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "MCP servers →" }));
  expect(location.pathname).toBe("/settings/mcp");
});

test("the page has no input, and says keys are set in a terminal", async () => {
  mount();
  await screen.findByRole("list", { name: "Model providers" });
  expect(screen.getByText("Keys are set and removed in a terminal. This page never sees, stores or sends one; it only shows where each key is.")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.querySelector("input")).toBeNull();
});

test("Refresh and a tab that is seen again read auth.list again", async () => {
  const { fake, user } = mount();
  await screen.findByRole("list", { name: "Model providers" });
  const before = fake.raw.listKeys.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fake.raw.listKeys.mock.calls.length).toBe(before + 1));
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(fake.raw.listKeys.mock.calls.length).toBe(before + 2));
});

test("the cache holds only the key-less shape, and a key a daemon wrongly sent is not drawn", async () => {
  const leaked = {
    providers: [{ provider: "anthropic", takes_key: true, needs_key: true, source: "env", env_var: "ANTHROPIC_API_KEY", key: "sk-secret-123" }],
  } as unknown as AuthListResult;
  const { page } = mount(leaked);
  await screen.findByRole("list", { name: "Model providers" });
  expect(document.body.textContent).not.toContain("sk-secret-123");
  const cached = page.queryClient.getQueryData<AuthListResult>([...KEYS_KEY]);
  expect(cached?.providers.map((status) => Object.keys(status).sort())).toEqual([["env_var", "needs_key", "provider", "source", "takes_key"]]);
});

test("axe is clean in both themes, with a drawer open", async () => {
  const { container, user } = mount();
  const models = await group("Model providers");
  await user.click(rowOf(models, "OpenAI").getByRole("button", { name: /Replace or remove/ }));
  for (const theme of ["slip", "kiln"]) {
    document.documentElement.dataset.theme = theme;
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  }
});
