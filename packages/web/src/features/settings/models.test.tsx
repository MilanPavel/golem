import { focusManager } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { AuthListResult } from "../../store/keys.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { HF_FILES, HF_RESULTS, OLLAMA_VALUES, SAMPLE_LISTING, TWO_KEYS } from "./models/models-sample.ts";
import { settingsContextStore } from "./index.ts";

const KEYS: AuthListResult = { providers: TWO_KEYS };
const WITH_GOOGLE: AuthListResult = { providers: [...TWO_KEYS, { provider: "google", takes_key: true, needs_key: true, source: "keychain", env_var: "GOOGLE_API_KEY" }] };

function mount(path = "/settings/models", keys: AuthListResult = KEYS, ollama = OLLAMA_VALUES, listing = SAMPLE_LISTING) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.listKeys.mockResolvedValue(keys);
  fake.raw.listModels.mockResolvedValue(listing);
  fake.raw.getOllamaSettings.mockResolvedValue(ollama);
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, user: userEvent.setup() };
}

const providers = async () => within(await screen.findByRole("group", { name: "Providers" }));

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
});

test("the list has All starred models, then On this Mac, Hosted and Not set up", async () => {
  mount();
  const list = await providers();
  const headings = list.getAllByRole("heading").map((heading) => heading.textContent);
  expect(headings).toEqual(["On this Mac", "Hosted", "Not set up · 4"]);
  const names = list.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  expect(names).toEqual([
    "All starred models, 5",
    "Ollama, 2 of 4 starred",
    "oMLX, later",
    "OpenAI, 1 of 3 starred",
    "Anthropic, 2 of 3 starred",
    "DeepSeek, set up",
    "Google, set up",
    "Moonshot, set up",
    "xAI, set up",
  ]);
});

test("a key that shows up when the tab is seen again moves its provider from Not set up to Hosted", async () => {
  const { fake } = mount();
  const list = await providers();
  expect(within(list.getByRole("heading", { name: "Not set up · 4" }).nextElementSibling as HTMLElement).getByRole("button", { name: "Google, set up" })).toBeTruthy();
  fake.raw.listKeys.mockResolvedValue(WITH_GOOGLE);
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(list.getByRole("heading", { name: "Not set up · 3" })).toBeTruthy());
  const hosted = list.getByRole("heading", { name: "Hosted" }).nextElementSibling as HTMLElement;
  expect(within(hosted).getByRole("button", { name: /^Google/ })).toBeTruthy();
});

test("the model list is read again when the tab is seen again", async () => {
  const { fake } = mount();
  await providers();
  const before = fake.raw.listModels.mock.calls.length;
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(fake.raw.listModels.mock.calls.length).toBeGreaterThan(before));
});

test("All starred models lists only the starred ones, with the count of the model menu", async () => {
  mount();
  expect(await screen.findByText("What the composer's model menu lists: 5 of 10 models.")).toBeTruthy();
  const table = screen.getByRole("table", { name: "All starred models" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(5);
  expect(within(table).queryByText("claude-opus")).toBeNull();
  const first = rows[0] as HTMLElement;
  expect(within(first).getByText("DEFAULT")).toBeTruthy();
  expect(within(first).getByText("free")).toBeTruthy();
  const sonnet = rows.find((row) => within(row).queryByText("claude-sonnet") !== null) as HTMLElement;
  expect(within(sonnet).getByText("$3 / $15")).toBeTruthy();
  expect(within(sonnet).getByText("Anthropic")).toBeTruthy();
});

test("the star sends model.star, and a starred model asks to be unstarred", async () => {
  const { fake, user } = mount();
  await user.click(await screen.findByRole("button", { name: "Anthropic, 2 of 3 starred" }));
  const table = await screen.findByRole("table", { name: "Anthropic models" });
  await user.click(screen.getByRole("button", { name: "Show all 3" }));
  const opus = within(table).getByRole("button", { name: "Show Claude Opus in the model menu" });
  expect(opus.getAttribute("aria-pressed")).toBe("false");
  await user.click(opus);
  await waitFor(() => expect(fake.raw.starModel).toHaveBeenCalledWith("anthropic/claude-opus", true));
  await user.click(within(table).getByRole("button", { name: "Show Claude Haiku in the model menu" }));
  await waitFor(() => expect(fake.raw.starModel).toHaveBeenCalledWith("anthropic/claude-haiku", false));
});

test("a hosted provider lists its starred models, and Show all lists the rest", async () => {
  const { fake, user } = mount();
  await user.click(await screen.findByRole("button", { name: "Anthropic, 2 of 3 starred" }));
  const table = await screen.findByRole("table", { name: "Anthropic models" });
  expect(screen.getByText("2 of 3 starred")).toBeTruthy();
  expect(within(table).getAllByRole("row").slice(1)).toHaveLength(2);
  expect(within(table).queryByText("claude-opus")).toBeNull();
  const toggle = screen.getByRole("button", { name: "Show all 3" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  await user.click(toggle);
  expect(within(table).getAllByRole("row").slice(1)).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Show starred only" }));
  expect(within(table).getAllByRole("row").slice(1)).toHaveLength(2);
  // An unstarred row stays until another provider is picked.
  await user.click(within(table).getByRole("button", { name: "Show Claude Haiku in the model menu" }));
  await waitFor(() => expect(fake.raw.starModel).toHaveBeenCalledWith("anthropic/claude-haiku", false));
  expect(within(table).getByText("claude-haiku")).toBeTruthy();
});

test("a provider says where its key is, and its menu opens the sheet with the two commands", async () => {
  const { user } = mount();
  await user.click(await screen.findByRole("button", { name: "Anthropic, 2 of 3 starred" }));
  expect(await screen.findByText("Key in the Keychain")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "More for Anthropic" }));
  await user.click(await screen.findByRole("menuitem", { name: "Replace or remove the key" }));
  const sheet = await screen.findByRole("dialog", { name: "Anthropic key" });
  expect(within(sheet).getByText("golem auth set anthropic")).toBeTruthy();
  expect(within(sheet).getByText("golem auth remove anthropic")).toBeTruthy();
  expect(within(sheet).queryByRole("textbox")).toBeNull();
});

test("a key from the environment says which variable, and the sheet says to unset it", async () => {
  const { user } = mount();
  await user.click(await screen.findByRole("button", { name: "OpenAI, 1 of 3 starred" }));
  expect(await screen.findByText("OPENAI_API_KEY")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "More for OpenAI" }));
  await user.click(await screen.findByRole("menuitem", { name: "Replace or remove the key" }));
  const sheet = await screen.findByRole("dialog", { name: "OpenAI key" });
  expect(within(sheet).getByText(/To remove it, unset/)).toBeTruthy();
});

test("a provider without a key shows the steps, with its command and variable, and copy puts the command on the clipboard", async () => {
  const writeText = vi.fn(async () => undefined);
  const { user } = mount();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await user.click(await screen.findByRole("button", { name: "DeepSeek, set up" }));
  const steps = await screen.findByRole("region", { name: "Set up DeepSeek" });
  expect(within(steps).getByText("golem auth set deepseek")).toBeTruthy();
  expect(within(steps).getByText("DEEPSEEK_API_KEY")).toBeTruthy();
  expect(within(steps).getByText("golem checks the key, then keeps it in the macOS Keychain. This page never sees it.")).toBeTruthy();
  expect(within(steps).getByText("Come back here. The page notices the key by itself.")).toBeTruthy();
  expect(within(steps).getByRole("link", { name: /Where/ }).getAttribute("href")).toBe("https://platform.deepseek.com/api_keys");
  await user.click(within(steps).getByRole("button", { name: "Copy golem auth set deepseek" }));
  expect(writeText).toHaveBeenCalledWith("golem auth set deepseek");
  await user.click(screen.getByRole("button", { name: "xAI, set up" }));
  const xai = await screen.findByRole("region", { name: "Set up xAI" });
  expect(within(xai).getByText("XAI_API_KEY")).toBeTruthy();
  expect(within(xai).getByText("golem auth set xai")).toBeTruthy();
});

test("oMLX says support is planned and nothing more", async () => {
  const { user } = mount();
  await user.click(await screen.findByRole("button", { name: "oMLX, later" }));
  expect(await screen.findByText(/golem can't use oMLX yet\./)).toBeTruthy();
  expect(screen.getByText("Support is planned.")).toBeTruthy();
});

test("Ollama lists its models on this Mac with speed, and Remove names what the default falls back to", async () => {
  const { fake, user } = mount();
  await user.click(await screen.findByRole("button", { name: /^Ollama/ }));
  const table = await screen.findByRole("table", { name: "Models on this Mac" });
  expect(within(table).getAllByRole("row")).toHaveLength(5);
  expect(within(table).queryByText("qwen3.8:32b")).toBeNull();
  expect(within(table).getByText("24 tok/s")).toBeTruthy();
  await user.click(within(table).getByRole("button", { name: "Remove Qwen 3.8 · 27B" }));
  const ask = await screen.findByRole("group", { name: "Remove Qwen 3.8 · 27B" });
  expect(within(ask).getByText(/Remove qwen3\.8:27b from Ollama\? It frees 16\.8 GB\./)).toBeTruthy();
  expect(within(ask).getByText(/It is the default for new chats\. They will start on Qwen 3\.8 · 8B instead\./)).toBeTruthy();
  expect(fake.raw.deleteModel).not.toHaveBeenCalled();
  await user.click(within(ask).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(fake.raw.deleteModel).toHaveBeenCalledWith("ollama/qwen3.8:27b"));
});

test("Ollama's state comes from the model list: stopped offers Start, not installed offers Install", async () => {
  const { user } = mount("/settings/models", KEYS, OLLAMA_VALUES, { ...SAMPLE_LISTING, setup: { ollama_installed: true, ollama_running: false } });
  await user.click(await screen.findByRole("button", { name: /^Ollama/ }));
  expect(await screen.findByText("Stopped")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start Ollama" })).toBeTruthy();
});

async function openGetModels(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^Ollama/ }));
  await user.click(await screen.findByRole("button", { name: "Get models" }));
  return await screen.findByRole("group", { name: "Get models" });
}

test("Get models opens as a page with the three tabs, and Back returns to Ollama's models", async () => {
  const { user } = mount();
  const page = await openGetModels(user);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("group", { name: "Providers" })).toBeNull();
  expect(within(page).getByText("64 GB memory")).toBeTruthy();
  const tabs = within(page).getAllByRole("tab");
  expect(tabs).toHaveLength(3);
  expect(tabs[0]?.textContent).toContain("Picked for this Mac");
  expect(tabs[1]?.textContent).toContain("Hugging Face");
  expect(tabs[2]?.textContent).toContain("By name");
  expect(within(page).getByText("Downloads keep going when you leave.")).toBeTruthy();
  await user.click(within(page).getByRole("button", { name: "Back to Ollama" }));
  expect(await screen.findByRole("button", { name: "Get models" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Providers" })).toBeTruthy();
});

test("Esc leaves Get models, and / goes to the search", async () => {
  const { user } = mount();
  const page = await openGetModels(user);
  await user.keyboard("/");
  expect(document.activeElement).toBe(within(page).getByRole("searchbox", { name: "Search" }));
  await user.keyboard("qw");
  expect((document.activeElement as HTMLInputElement).value).toBe("qw");
  await user.keyboard("{Escape}");
  expect(await screen.findByRole("group", { name: "Providers" })).toBeTruthy();
});

test("Get models › Picked for this Mac: a line a model, with its categories, size and fit", async () => {
  const { user } = mount();
  const page = await openGetModels(user);
  const card = within(page).getByRole("group", { name: "Recommended for this Mac" });
  expect(card.textContent).toContain("Qwen 3.8 · 32B");
  expect(card.textContent).toContain("20 GB. The pick for this Mac's 64 GB of memory. Good for general and reasoning.");
  const list = within(page).getByRole("list", { name: "Models for this Mac" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(7);
  const big = rows.find((row) => row.textContent?.includes("qwen3.8:72b"));
  expect(big?.textContent).toContain("Reasoning");
  expect(big?.textContent).toContain("47 GB");
  expect(big?.textContent).toContain("Too big");
  expect(rows.find((row) => row.textContent?.includes("llama4-scout"))?.textContent).toContain("Tight · slower");
  expect(rows.find((row) => row.textContent?.includes("qwen3.8:8b"))?.textContent).toContain("Installed");
});

test("Get models › the search, the chips and Hide the ones too big filter the list, and an empty result offers the other tabs", async () => {
  const { user } = mount();
  const page = await openGetModels(user);
  const names = () => within(within(page).getByRole("list", { name: "Models for this Mac" })).getAllByRole("listitem").map((row) => row.textContent ?? "");
  await user.click(within(page).getByRole("button", { name: "Vision" }));
  expect(names()).toHaveLength(1);
  expect(names()[0]).toContain("llama4-scout");
  expect(within(page).queryByRole("group", { name: "Recommended for this Mac" })).toBeNull();
  await user.click(within(page).getByRole("button", { name: "All" }));
  expect(within(page).getByRole("group", { name: "Recommended for this Mac" })).toBeTruthy();
  await user.click(within(page).getByRole("switch", { name: "Hide the ones too big" }));
  expect(names().some((name) => name.includes("qwen3.8:72b"))).toBe(false);
  await user.type(within(page).getByRole("searchbox", { name: "Search" }), "gemma");
  expect(names()).toHaveLength(1);
  expect(names()[0]).toContain("gemma4:12b");
  await user.clear(within(page).getByRole("searchbox", { name: "Search" }));
  await user.type(within(page).getByRole("searchbox", { name: "Search" }), "nothing like this");
  expect(within(page).getByText("Not in golem's list")).toBeTruthy();
  await user.click(within(page).getByRole("button", { name: "Search Hugging Face" }));
  expect(within(page).getByRole("tab", { name: /Hugging Face/ }).getAttribute("aria-selected")).toBe("true");
  expect(within(page).getByRole("textbox", { name: "Search Hugging Face" })).toBeTruthy();
});

test("Get models › Download starts the pull and the page stays: progress, a cancel, then Installed", async () => {
  const { fake, user } = mount();
  const page = await openGetModels(user);
  const list = within(page).getByRole("list", { name: "Models for this Mac" });
  await user.click(within(list).getByRole("button", { name: "Download qwen3.8:32b" }));
  await waitFor(() => expect(fake.raw.pullModel).toHaveBeenCalledWith("ollama/qwen3.8:32b"));
  expect(screen.getByRole("group", { name: "Get models" })).toBeTruthy();
  expect(within(list).getByRole("progressbar", { name: "Downloading qwen3.8:32b" })).toBeTruthy();
  act(() => {
    fake.emitPull({ kind: "progress", progress: { ref: "ollama/qwen3.8:32b", status: "pulling", completed: 5e9, total: 20e9, progress: 0.25 } });
  });
  expect(within(list).getByText("25%")).toBeTruthy();
  await user.click(within(list).getByRole("button", { name: "Stop downloading qwen3.8:32b" }));
  await waitFor(() => expect(fake.raw.cancelPull).toHaveBeenCalledWith("ollama/qwen3.8:32b"));
});

test("Get models › a model that is too big still downloads", async () => {
  const { fake, user } = mount();
  const page = await openGetModels(user);
  await user.click(within(page).getByRole("button", { name: "Download qwen3.8:72b" }));
  await waitFor(() => expect(fake.raw.pullModel).toHaveBeenCalledWith("ollama/qwen3.8:72b"));
  expect(screen.getByRole("group", { name: "Get models" })).toBeTruthy();
});

test("Get models › By name downloads the name that was typed", async () => {
  const { fake, user } = mount();
  await openGetModels(user);
  await user.click(await screen.findByRole("tab", { name: /By name/ }));
  await user.type(screen.getByRole("textbox", { name: /An Ollama name/ }), "mistral-small3");
  await user.click(screen.getByRole("button", { name: "Download" }));
  await waitFor(() => expect(fake.raw.pullModel).toHaveBeenCalledWith("ollama/mistral-small3"));
  expect(screen.getByRole("group", { name: "Get models" })).toBeTruthy();
});

async function openHf(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^Ollama/ }));
  await user.click(await screen.findByRole("button", { name: "Get models" }));
  await user.click(await screen.findByRole("tab", { name: /Hugging Face/ }));
  await user.type(screen.getByRole("textbox", { name: "Search Hugging Face" }), "qwen3.8 27b{Enter}");
}

test("Get models › Hugging Face lists the repos found, and a gated one cannot be opened", async () => {
  const { fake, user } = mount();
  fake.raw.searchHf.mockResolvedValue(HF_RESULTS);
  await openHf(user);
  await waitFor(() => expect(fake.raw.searchHf).toHaveBeenCalledWith("qwen3.8 27b"));
  const list = await screen.findByRole("list", { name: "Hugging Face repos" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(within(list).getByText("↓ 412K", { exact: false })).toBeTruthy();
  expect(within(list).getByText("Needs a Hugging Face token (later)")).toBeTruthy();
  expect(within(list).queryByRole("button", { name: /Llama-4-Scout/ })).toBeNull();
});

test("a Hugging Face repo shows its sizes in words, and a too big size still downloads", async () => {
  const { fake, user } = mount();
  fake.raw.searchHf.mockResolvedValue(HF_RESULTS);
  fake.raw.hfFiles.mockResolvedValue(HF_FILES);
  await openHf(user);
  await user.click(await screen.findByRole("button", { name: `Open ${HF_FILES.repo}` }));
  expect(fake.raw.hfFiles).toHaveBeenCalledWith(HF_FILES.repo);
  const sizes = await screen.findByRole("list", { name: `Sizes of ${HF_FILES.repo}` });
  const rows = within(sizes).getAllByRole("listitem");
  expect(rows[1]?.textContent).toContain("Recommended");
  expect(rows[0]?.textContent).toContain("Fits");
  expect(rows[3]?.textContent).toContain("Tight: it will spill to the CPU and run slower");
  expect(rows[4]?.textContent).toContain("Too big for this Mac");
  expect(screen.getByRole("link", { name: "Open on Hugging Face ↗" }).getAttribute("href")).toBe(`https://huggingface.co/${HF_FILES.repo}`);
  await user.click(within(sizes).getByRole("button", { name: "Download F16" }));
  await waitFor(() => expect(fake.raw.pullModel).toHaveBeenCalledWith(`ollama/hf.co/${HF_FILES.repo}:F16`));
  expect(screen.getByRole("group", { name: "Get models" })).toBeTruthy();
});

test("a Hugging Face download shows as a row in Ollama's table with where it comes from", async () => {
  const { fake, user } = mount();
  fake.raw.searchHf.mockResolvedValue(HF_RESULTS);
  fake.raw.hfFiles.mockResolvedValue(HF_FILES);
  await openHf(user);
  await user.click(await screen.findByRole("button", { name: `Open ${HF_FILES.repo}` }));
  await user.click(await screen.findByRole("button", { name: "Download Q4_K_M" }));
  await user.click(screen.getByRole("button", { name: "Back to Ollama" }));
  await waitFor(() => expect(screen.getByRole("progressbar", { name: `Downloading hf.co/${HF_FILES.repo}:Q4_K_M` })).toBeTruthy());
  expect(screen.getByText("from Hugging Face · Q4_K_M")).toBeTruthy();
  expect(screen.getByRole("button", { name: `Stop downloading hf.co/${HF_FILES.repo}:Q4_K_M` })).toBeTruthy();
});

test("Ollama Settings sends ollama.settings.set with the three values", async () => {
  const { fake, user } = mount();
  await user.click(await screen.findByRole("button", { name: /^Ollama/ }));
  await user.click(await screen.findByRole("button", { name: "Ollama settings" }));
  const sheet = await screen.findByRole("dialog", { name: "Ollama settings" });
  expect(within(sheet).queryByText(/started outside golem/)).toBeNull();
  const idle = within(sheet).getByRole("textbox", { name: /Stop it after this many minutes unused/ });
  await user.clear(idle);
  await user.type(idle, "0");
  const parallel = within(sheet).getByRole("textbox", { name: /Parallel/ });
  await user.clear(parallel);
  await user.type(parallel, "3");
  await user.click(within(sheet).getByRole("checkbox", { name: /Start Ollama when a model needs it/ }));
  await user.click(within(sheet).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fake.raw.setOllamaSettings).toHaveBeenCalledWith({ start: false, idle_stop_minutes: 0, parallel: 3 }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ollama settings" })).toBeNull());
});

test("Ollama Settings refuses a parallel outside 1 to 8 before it sends anything", async () => {
  const { fake, user } = mount();
  await user.click(await screen.findByRole("button", { name: /^Ollama/ }));
  await user.click(await screen.findByRole("button", { name: "Ollama settings" }));
  const parallel = await screen.findByRole("textbox", { name: /Parallel/ });
  await user.clear(parallel);
  await user.type(parallel, "12");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("1 to 8");
  expect(fake.raw.setOllamaSettings).not.toHaveBeenCalled();
});

test("the outside-golem note shows when golem did not start Ollama", async () => {
  const { user } = mount("/settings/models", KEYS, { ...OLLAMA_VALUES, started_by_golem: false });
  await user.click(await screen.findByRole("button", { name: /^Ollama/ }));
  await user.click(await screen.findByRole("button", { name: "Ollama settings" }));
  expect(await screen.findByText("This Ollama was started outside golem, so it keeps its own parallel setting.")).toBeTruthy();
});

test("/settings/keys goes to Models, and the nav has no API keys", async () => {
  mount("/settings/keys");
  await providers();
  expect(location.pathname).toBe("/settings/models");
  expect(screen.getByRole("heading", { level: 2, name: "Models" })).toBeTruthy();
  expect(screen.getByText("Where golem's models come from, and which ones show in the model menu.")).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(within(nav).queryByRole("link", { name: "API keys" })).toBeNull();
  expect(within(nav).getByRole("link", { name: "Models" }).getAttribute("aria-current")).toBe("page");
});
