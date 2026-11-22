import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { McpServer } from "../../store/mcp.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { OK_ROWS, WORKING_LISTING } from "../setup/sample.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const FILE = "/Users/me/.golem/config.toml";

const hub: McpServer = {
  name: "hub",
  state: "running",
  command: "https://api.example.com/mcp/",
  tools: ["mcp__hub__list"],
  config: FILE,
  on_demand: false,
  enabled: null,
};
const plain: McpServer = { name: "plain", state: "running", command: "mcp-server-plain", tools: [], config: FILE, on_demand: false, enabled: null };
const linear: McpServer = { name: "linear", state: "needs_auth", command: "https://mcp.linear.app/mcp", error: "signed out", config: FILE, on_demand: false, enabled: null };
const HUB_ROW = /^running,\s*hub/;
const HUB_CONFIG = { url: "https://api.example.com/mcp/", headers: { Authorization: "Bearer keychain:mcp/hub" } };

type Fake = ReturnType<typeof fakeClient>;

function mount(servers: readonly McpServer[], prepare?: (fake: Fake) => void) {
  history.replaceState(null, "", "/settings/mcp");
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue(WORKING_LISTING);
  fake.raw.setupStatus.mockResolvedValue({ rows: OK_ROWS });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.listMcp.mockResolvedValue({ servers: [...servers] });
  prepare?.(fake);
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

/** `mcp.get` for the hub: its config, and whether the Keychain has the secret it names. */
function withToken(stored: boolean) {
  return (made: Fake) => {
    made.raw.mcpGet.mockResolvedValue({ config: HUB_CONFIG, path: FILE, scope: "user", secrets: [{ ref: "mcp/hub", stored }], server: hub } as never);
  };
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  closePalette();
  settingsContextStore.set(null);
});

test("a token that is in the Keychain shows the sign-in line, with when it worked and Replace", async () => {
  const { user } = mount([hub], withToken(true));
  await user.click(await screen.findByRole("button", { name: HUB_ROW }));
  const line = await screen.findByText("Token");
  const text = line.closest("p")?.textContent ?? "";
  expect(text).toContain("in the Keychain as mcp/hub");
  expect(text).toContain("worked just now");
  expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
});

test("a secret that is not in the Keychain says Token missing, with Add it", async () => {
  const { user } = mount([hub], withToken(false));
  await user.click(await screen.findByRole("button", { name: HUB_ROW }));
  expect(await screen.findByText("Token missing")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add it" })).toBeTruthy();
});

test("a connect the server refused with 401 says Token refused, with Replace", async () => {
  const refused: McpServer = { ...hub, state: "failed", tools: [], error: "HTTP 401: bad credentials" };
  const { user } = mount([refused], withToken(true));
  await user.click(await screen.findByRole("button", { name: /hub/ }));
  expect(await screen.findByText("Token refused")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
});

test("a server with no secret shows no sign-in line", async () => {
  const { user } = mount([plain]);
  await user.click(await screen.findByRole("button", { name: /plain/ }));
  await screen.findByRole("heading", { name: "plain" });
  expect(screen.queryByText(/^Token/)).toBeNull();
  expect(screen.queryByText("Signed in")).toBeNull();
  expect(screen.queryByText("Not signed in")).toBeNull();
});

test("an OAuth server says Not signed in, or Signed in with Sign out", async () => {
  const first = mount([linear]);
  await first.user.click(await screen.findByRole("button", { name: /linear/ }));
  expect(await screen.findByText("Not signed in")).toBeTruthy();
  first.unmount();
  const signedIn: McpServer = { ...linear, state: "running", error: null, tools: ["mcp__linear__list_issues"] };
  const second = mount([signedIn], (made) => {
    made.raw.mcpCatalog.mockResolvedValue({
      entries: [{ id: "linear", name: "linear", title: "Linear", description: "Issues.", category: "productivity", homepage: "https://linear.app", runtime: "url", auth: "oauth", added: true }],
    });
  });
  await second.user.click(await screen.findByRole("button", { name: /linear/ }));
  expect(await screen.findByText("Signed in")).toBeTruthy();
  await second.user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(second.fake.raw.mcpLogout).toHaveBeenCalledWith("linear", undefined);
});

test("Replace on the line opens Edit with the token field focused, and the stored value is not on the page", async () => {
  const { user } = mount([hub], withToken(true));
  await user.click(await screen.findByRole("button", { name: HUB_ROW }));
  await user.click(await screen.findByRole("button", { name: "Replace" }));
  const field = (await screen.findByLabelText("header 1 value")) as HTMLInputElement;
  expect(field.type).toBe("password");
  expect(field.value).toBe("");
  expect(document.activeElement).toBe(field);
  expect(screen.getByText("Bearer")).toBeTruthy();
  expect(document.body.textContent).not.toContain("keychain:mcp/hub");
});

async function replaceWith(user: ReturnType<typeof userEvent.setup>, token: string): Promise<void> {
  await user.click(await screen.findByRole("tab", { name: "Edit" }));
  await user.click(await screen.findByRole("button", { name: "Replace the token of header 1" }));
  await user.type(screen.getByLabelText("header 1 value"), token);
}

const PASSING = {
  test_id: "t",
  ok: true,
  steps: [
    { step: "resolve", state: "ok", elapsed_ms: 1 },
    { step: "connect", state: "ok", elapsed_ms: 1 },
    { step: "initialize", state: "ok", elapsed_ms: 1 },
    { step: "tools", state: "ok", elapsed_ms: 1, detail: "3 tools" },
    { step: "ping", state: "ok", elapsed_ms: 1 },
  ],
  tools: [],
  stderr_tail: [],
} as never;
const REFUSED = {
  test_id: "t",
  ok: false,
  steps: [
    { step: "resolve", state: "ok", elapsed_ms: 1 },
    { step: "connect", state: "ok", elapsed_ms: 1 },
    { step: "initialize", state: "failed", elapsed_ms: 1, detail: "HTTP 401: nope" },
    { step: "tools", state: "skipped" },
    { step: "ping", state: "skipped" },
  ],
  tools: [],
  stderr_tail: [],
  http_status: 401,
} as never;

test("Save and test tests the draft with the new token, and sends mcp.update only when it passes", async () => {
  const { fake, user } = mount([hub], withToken(true));
  const order: string[] = [];
  fake.raw.mcpTest.mockImplementation(async () => {
    order.push("test");
    return PASSING;
  });
  fake.raw.updateMcpServer.mockImplementation(async () => {
    order.push("update");
    return {} as never;
  });
  await user.click(await screen.findByRole("button", { name: HUB_ROW }));
  await replaceWith(user, "sekret-123");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Save and test" }));
  expect(await screen.findByText("The new token works. It replaced the old one.")).toBeTruthy();
  expect(order).toEqual(["test", "update"]);
  expect(fake.raw.mcpTest.mock.calls[0]![0]).toMatchObject({ config: HUB_CONFIG, secrets: { "mcp/hub": "sekret-123" } });
  expect(fake.raw.updateMcpServer.mock.calls[0]![0]).toMatchObject({ name: "hub", secrets: { "mcp/hub": "sekret-123" } });
  const steps = screen.getByRole("list", { name: "Test steps" }).textContent ?? "";
  expect(steps).toContain("Connected to api.example.com");
  expect(steps).toContain("Signed in");
  expect(steps).toContain("Listed 3 tools");
  // The token is gone from the page once it is kept.
  expect(document.body.innerHTML).not.toContain("sekret-123");
  expect(screen.queryByLabelText("header 1 value")).toBeNull();
});

test("a token the server refuses is not saved, says the old one is in use, and Try again asks for another", async () => {
  const { fake, user } = mount([hub], withToken(true));
  fake.raw.mcpTest.mockResolvedValue(REFUSED);
  await user.click(await screen.findByRole("button", { name: HUB_ROW }));
  await replaceWith(user, "bad-token");
  await user.click(screen.getByRole("button", { name: "Save and test" }));
  expect((await screen.findByRole("alert")).textContent).toBe("The server refused this token. Your old token is still in use.");
  expect(fake.raw.updateMcpServer).not.toHaveBeenCalled();
  // The sign-in line learns of the refusal.
  expect(await screen.findByText("Token refused")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  const field = screen.getByLabelText("header 1 value") as HTMLInputElement;
  expect(field.value).toBe("");
  expect(document.activeElement).toBe(field);
});

test("Keep it anyway saves a refused token", async () => {
  const { fake, user } = mount([hub], withToken(true));
  fake.raw.mcpTest.mockResolvedValue(REFUSED);
  await user.click(await screen.findByRole("button", { name: HUB_ROW }));
  await replaceWith(user, "bad-token");
  await user.click(screen.getByRole("button", { name: "Save and test" }));
  await user.click(await screen.findByRole("button", { name: "Keep it anyway" }));
  await waitFor(() => expect(fake.raw.updateMcpServer).toHaveBeenCalledTimes(1));
  expect(fake.raw.updateMcpServer.mock.calls[0]![0]).toMatchObject({ name: "hub", secrets: { "mcp/hub": "bad-token" } });
  expect(await screen.findByText(/Kept the new token/)).toBeTruthy();
  expect(document.body.innerHTML).not.toContain("bad-token");
});

test("a test that fails for another reason says what failed, with the same two choices", async () => {
  const { fake, user } = mount([hub], withToken(true));
  fake.raw.mcpTest.mockResolvedValue({
    test_id: "t",
    ok: false,
    steps: [
      { step: "resolve", state: "failed", elapsed_ms: 1, detail: "cannot resolve api.example.com" },
      { step: "connect", state: "skipped" },
    ],
    tools: [],
    stderr_tail: [],
  } as never);
  await user.click(await screen.findByRole("button", { name: HUB_ROW }));
  await replaceWith(user, "tok");
  await user.click(screen.getByRole("button", { name: "Save and test" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Could not find the server: cannot resolve api.example.com. Your old token is still in use.");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Keep it anyway" })).toBeTruthy();
  expect(fake.raw.updateMcpServer).not.toHaveBeenCalled();
});

test("the Test button in the header updates the sign-in line", async () => {
  const stuck: McpServer = { ...hub, state: "failed", tools: [], error: "the server did not answer" };
  const { fake, user } = mount([stuck], withToken(true));
  fake.raw.mcpTest.mockResolvedValue(REFUSED);
  await user.click(await screen.findByRole("button", { name: /hub/ }));
  await screen.findByText("Token");
  await user.click(screen.getByRole("button", { name: "Test" }));
  expect(await screen.findByText("Token refused")).toBeTruthy();
});

test("the sign-in line and the Edit token pill have no axe violations", async () => {
  const { user, container } = mount([hub], withToken(false));
  await user.click(await screen.findByRole("button", { name: HUB_ROW }));
  await screen.findByText("Token missing");
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
  await user.click(screen.getByRole("tab", { name: "Edit" }));
  await screen.findByRole("button", { name: "Add the token of header 1" });
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});
