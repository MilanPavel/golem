import { focusManager } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { KEYS_KEY, type AuthListResult } from "../../store/keys.ts";
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
    { provider: "ollama", takes_key: false, needs_key: false, source: null, env_var: null },
  ],
};

function mount(keys: AuthListResult = KEYS) {
  history.replaceState(null, "", "/settings/keys");
  const fake = fakeClient();
  fake.raw.listKeys.mockResolvedValue(keys);
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

test("it lists only the providers that take a key, with where each key is", async () => {
  mount();
  const list = await screen.findByRole("list", { name: "API keys" });
  const items = within(list).getAllByRole("listitem").map((item) => item.textContent);
  expect(items).toHaveLength(3);
  expect(items[0]).toContain("anthropic");
  expect(items[0]).toContain("from ANTHROPIC_API_KEY");
  expect(items[1]).toContain("in the Keychain");
  expect(screen.queryByText("ollama")).toBeNull();
});

test("a missing key is a warning row with the command and Copy", async () => {
  mount();
  const list = await screen.findByRole("list", { name: "API keys" });
  const row = within(list).getByText("openrouter").closest("li") as HTMLElement;
  expect(within(row).getByText("missing")).toBeTruthy();
  expect(within(row).getByText("golem auth set openrouter").tagName).toBe("CODE");
  expect(within(row).getByRole("button", { name: /^Copy / })).toBeTruthy();
});

test("the section has no input and no remove control, and says keys are set in a terminal", async () => {
  mount();
  await screen.findByRole("list", { name: "API keys" });
  expect(screen.getByText("Keys are set and removed in a terminal. The page never sees one.")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /remove|set key|delete/i })).toBeNull();
});

test("Refresh and a tab that is seen again read auth.list again", async () => {
  const { fake, user } = mount();
  await screen.findByRole("list", { name: "API keys" });
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
  await screen.findByRole("list", { name: "API keys" });
  expect(document.body.textContent).not.toContain("sk-secret-123");
  const cached = page.queryClient.getQueryData<AuthListResult>([...KEYS_KEY]);
  expect(cached?.providers.map((status) => Object.keys(status).sort())).toEqual([["env_var", "needs_key", "provider", "source", "takes_key"]]);
});

test("axe is clean in both themes", async () => {
  const { container } = mount();
  await screen.findByRole("list", { name: "API keys" });
  for (const theme of ["slip", "kiln"]) {
    document.documentElement.dataset.theme = theme;
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
  }
});
