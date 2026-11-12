import type { ModelListResult } from "../../store/models.ts";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { setupAtStart } from "@golem/view";
import { closeSetup, openSetup } from "./setup-open.ts";
import { startNoticeStore } from "./start-notice.ts";
import {
  FRESH_LISTING,
  GONE_LISTING,
  KEYED_LISTING,
  RUNNING_LISTING,
  OK_ROWS,
  STATUS_ROWS,
  STOPPED_LISTING,
  WORKING_LISTING,
} from "./sample.ts";

const popup = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const MODEL_NOT_CONFIGURED = -32005;

/** Two models already on this Mac and no default: setup has a choice to ask for. */
const TWO_READY: ModelListResult = {
  ...RUNNING_LISTING,
  models: RUNNING_LISTING.models.map((each, index) =>
    index < 2 ? { ...each, status: "ready" as const, source: "installed" as const } : each,
  ),
};

type Options = { rows?: typeof STATUS_ROWS; path?: string; hold?: boolean };

function mount(listing: ModelListResult, { rows = STATUS_ROWS, path = "/", hold = false }: Options = {}) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  const state = { listing, release: () => {} };
  const gate = new Promise<void>((resolve) => {
    state.release = resolve;
  });
  fake.raw.listModels.mockImplementation(async () => {
    if (hold) await gate;
    return state.listing;
  });
  fake.raw.setupStatus.mockResolvedValue({ rows });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  // The page's start opens /welcome, not this window: these tests are about the window, so open it
  // the way the start used to, and leave the start rule to the welcome tests.
  const start = setupAtStart(true, listing);
  if (start?.kind === "window") {
    page.setupStart.decide();
    openSetup({ window: start.window });
  }
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, state, user: userEvent.setup(), ...view };
}

const dialog = () => screen.getByRole("dialog", { name: "Setup" });
const found = () => screen.findByRole("dialog", { name: "Setup" });
const closed = () => expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
const choice = (name: string | RegExp) => within(dialog()).getByRole("button", { name });
const choices = () => within(dialog()).getAllByRole("button").filter((button) => button.getAttribute("aria-current") !== null || button.closest("[aria-label=Choices]") !== null);
const current = () => choices().find((button) => button.getAttribute("aria-current") === "true");
const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const steps = () => within(dialog()).queryByRole("list", { name: "Setup steps" });

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  startNoticeStore.set(null);
  closeSetup();
  closePalette();
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
});

// The window at its start states

test("a fresh home opens guided setup on Engine, with the stepper", async () => {
  mount(FRESH_LISTING);
  const open = await found();
  expect(within(open).getByText("Where should golem think?")).toBeTruthy();
  const list = steps();
  expect(list?.textContent).toContain("Service (done)");
  expect(list?.textContent).toContain("Engine (current step)");
  expect(list?.textContent).toContain("Model (to do)");
  expect(within(open).getByText(/Step 2\/5 Engine/)).toBeTruthy();
});

test("a default that is gone opens the Model panel alone, naming it, with no stepper", async () => {
  mount(GONE_LISTING);
  const open = await found();
  expect(await within(open).findByText(/ollama\/qwen3:8b is no longer installed in Ollama\./)).toBeTruthy();
  expect(steps()).toBeNull();
});

test("a working setup opens nothing", async () => {
  const { fake } = mount(WORKING_LISTING);
  await waitFor(() => expect(fake.raw.listModels).toHaveBeenCalled());
  await wait();
  closed();
});

test("the only model ready, with no default, becomes the default and no window opens", async () => {
  const one: ModelListResult = {
    ...RUNNING_LISTING,
    models: RUNNING_LISTING.models.map((each, index) => (index === 0 ? { ...each, status: "ready" as const, source: "installed" as const } : each)),
  };
  const { fake } = mount(one);
  await waitFor(() => expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/gemma4:e4b"));
  await screen.findByText("Using ollama/gemma4:e4b, the only model ready. /setup to change.");
  closed();
});

test("a window opened at the start is still there after the link drops and comes back", async () => {
  // The first load trades the token and then reconnects: the shell unmounts and mounts again.
  const { fake } = mount(FRESH_LISTING);
  await found();
  act(() => fake.setState({ status: "reconnecting", attempt: 1, delayMs: 1000 }));
  await wait();
  expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
  act(() => fake.setState({ status: "connected" }));
  await within(await found()).findByText("Where should golem think?");
});

test("/setup opens the overview from the composer, and focus goes back to it", async () => {
  const { user } = mount(WORKING_LISTING);
  await user.click(box());
  await user.type(box(), "/setup{Enter}");
  const open = await found();
  await within(open).findByText("Install Ollama");
  expect(within(open).getByText("Service")).toBeTruthy();
  expect(within(open).getByText(/running · v0\.5\.0 · starts at login/)).toBeTruthy();
  expect(steps()).toBeNull();
  await user.keyboard("{Escape}");
  await waitFor(closed);
  expect(document.activeElement).toBe(box());
});

test("the palette's /setup row opens the overview and is not marked as terminal-only", async () => {
  const { user } = mount(WORKING_LISTING, { rows: OK_ROWS });
  await user.click(box());
  await user.keyboard("{Control>}k{/Control}");
  const palette = await screen.findByRole("dialog", { name: "Commands" });
  await user.type(within(palette).getByRole("combobox"), "setup");
  const row = within(palette).getAllByRole("option")[0] as HTMLElement;
  expect(row.textContent).toContain("/setup");
  expect(row.textContent).not.toContain("In the terminal for now");
  await user.keyboard("{Enter}");
  const open = await found();
  await within(open).findByText("Change model");
  await user.keyboard("{Escape}");
  await waitFor(closed);
  expect(document.activeElement).toBe(box());
});

test("a send with no model chosen opens guided setup on Engine, and the draft stays", async () => {
  const { fake, user } = mount(WORKING_LISTING);
  fake.raw.sendMessage.mockRejectedValue(rpcError(MODEL_NOT_CONFIGURED, "no model chosen yet"));
  await user.click(box());
  await user.type(box(), "explain this repo{Enter}");
  const open = await found();
  expect(within(open).getByText("Pick how golem thinks, then Enter sends your message.")).toBeTruthy();
  expect(within(open).queryByRole("button", { name: /Later/ })).toBeNull();
  expect(steps()?.textContent).toContain("Service (skipped)");
  await user.click(within(open).getByRole("button", { name: "Close setup" }));
  await waitFor(closed);
  expect(box().value).toBe("explain this repo");
});

// Moving through the window

test("Engine, On this Mac, Ollama, Model, Ready, and the window closes", async () => {
  const { fake, state, user } = mount(STOPPED_LISTING);
  await found();
  // Ollama is installed and stopped: the panel starts it, then lists again and goes on to the models.
  state.listing = TWO_READY;
  await user.click(choice(/On this Mac/));
  await within(dialog()).findByText(/Pick a model · Ollama/);
  expect(fake.raw.startOllama).toHaveBeenCalledTimes(1);
  expect(steps()?.textContent).toContain("Model (current step)");
  await user.click(choice(/Gemma 4 E4B/));
  await within(dialog()).findByText("golem is ready");
  expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/gemma4:e4b");
  const text = dialog().textContent ?? "";
  expect(text).toContain("Ollama on this Mac");
  expect(text).toContain("Gemma 4 E4B · saved as default");
  expect(steps()?.textContent).toContain("Ready (current step)");
  await user.click(choice("Start chatting"));
  await waitFor(closed);
});

test("Esc steps back through the guided panels, and Esc on Service at the start closes", async () => {
  const { user } = mount(FRESH_LISTING);
  await found();
  await user.click(choice(/With an API key/));
  await within(dialog()).findByText("With an API key · which provider?");
  await user.keyboard("{Escape}");
  await within(dialog()).findByText("Where should golem think?");
  await user.keyboard("{Escape}");
  // A guided start on Engine has Service behind it.
  await within(dialog()).findByText("service running");
  await user.keyboard("{Escape}");
  await waitFor(closed);
});

test("the Back button steps back like Esc", async () => {
  const { user } = mount(FRESH_LISTING);
  await found();
  await user.click(choice(/With an API key/));
  await user.click(within(dialog()).getByRole("button", { name: "Back" }));
  await within(dialog()).findByText("Where should golem think?");
});

test("the close button closes at any point, and the download goes on", async () => {
  const { page, fake, user } = mount(RUNNING_LISTING);
  await found();
  await user.click(choice(/On this Mac/));
  await user.click(choice(/Gemma 4 E4B/));
  await waitFor(() => expect(fake.raw.pullModel).toHaveBeenCalledWith("ollama/gemma4:e4b"));
  await user.click(within(dialog()).getByRole("button", { name: "Close setup" }));
  await waitFor(closed);
  expect(page.pulls.getSnapshot().active.has("ollama/gemma4:e4b")).toBe(true);
});

test("a window that opens on a guided Service panel at the start closes on Esc, where the table says quit", async () => {
  const { guided } = await import("@golem/view");
  const { openSetup } = await import("./setup-open.ts");
  mount(WORKING_LISTING);
  await wait();
  act(() => openSetup({ window: guided("service", "start") }));
  await within(await found()).findByText("service running");
  await userEvent.keyboard("{Escape}");
  await waitFor(closed);
});

test("keys and clicks agree on a list of choices", async () => {
  const keys = mount(FRESH_LISTING);
  await found();
  expect(current()?.textContent).toContain("On this Mac");
  await keys.user.keyboard("{ArrowDown}");
  expect(current()?.textContent).toContain("With an API key");
  await keys.user.keyboard("{Enter}");
  await within(dialog()).findByText("With an API key · which provider?");
  keys.unmount();
  closeSetup();

  const clicks = mount(FRESH_LISTING);
  await found();
  await clicks.user.click(choice(/With an API key/));
  await within(dialog()).findByText("With an API key · which provider?");
  expect(current()?.textContent).toContain("Anthropic");
  // The second: the same moves as the keys, then Enter.
  await clicks.user.click(choice(/OpenAI/));
  await within(dialog()).findByText("OpenAI · API key");
});

// Ollama

test("an install streams its output, and a finished install starts Ollama and goes on", async () => {
  const { fake, state, user } = mount(FRESH_LISTING);
  await found();
  await user.click(choice(/On this Mac/));
  await within(dialog()).findByText("Ollama isn't installed");
  await user.click(choice("Install with Homebrew"));
  await waitFor(() => expect(fake.raw.installOllama).toHaveBeenCalledTimes(1));
  await within(dialog()).findByText("brew install ollama");
  act(() => fake.emitInstall({ kind: "output", text: "==> Downloading ollama\n==> Pouring ollama-0.12\nPartial" }));
  await within(dialog()).findByText("==> Pouring ollama-0.12");
  state.listing = TWO_READY;
  act(() => fake.emitInstall({ kind: "done", done: { outcome: "installed" } }));
  await within(dialog()).findByText(/Pick a model · Ollama/);
  expect(fake.raw.startOllama).toHaveBeenCalledTimes(1);
});

test("Esc while it installs stops the install, and the panel says so", async () => {
  const { fake, user } = mount(FRESH_LISTING);
  await found();
  await user.click(choice(/On this Mac/));
  await user.click(choice("Install with Homebrew"));
  await within(dialog()).findByText("brew install ollama");
  expect(within(dialog()).getByText("Esc stops")).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(fake.raw.cancelOllamaInstall).toHaveBeenCalledTimes(1));
  act(() => fake.emitInstall({ kind: "done", done: { outcome: "stopped" } }));
  await within(dialog()).findByText("stopped the install");
});

test("a failed install says why and offers Retry", async () => {
  const { fake, user } = mount(FRESH_LISTING);
  await found();
  await user.click(choice(/On this Mac/));
  await user.click(choice("Install with Homebrew"));
  await within(dialog()).findByText("brew install ollama");
  act(() => fake.emitInstall({ kind: "done", done: { outcome: "failed", reason: "Error: no space left" } }));
  await within(dialog()).findByText("Ollama didn't install");
  expect(within(dialog()).getByText("Error: no space left")).toBeTruthy();
  expect(choice("Retry")).toBeTruthy();
});

test("a stopped Ollama is started by the panel", async () => {
  const { fake, user } = mount(STOPPED_LISTING);
  await found();
  fake.raw.startOllama.mockResolvedValue({ running: false });
  await user.click(choice(/On this Mac/));
  await within(dialog()).findByText("Ollama didn't start");
  expect(fake.raw.startOllama).toHaveBeenCalledTimes(1);
});

test("with no Homebrew the page links ollama.com, waits, and goes on once Ollama is there", async () => {
  const { RpcError, OLLAMA_FAILED } = await import("@golem/client");
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const { fake, state, user } = mount(FRESH_LISTING);
  fake.raw.installOllama.mockRejectedValue(new RpcError(OLLAMA_FAILED, "no Homebrew", { no_brew: true }));
  await found();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await user.click(choice(/On this Mac/));
  await user.click(choice("Install with Homebrew"));
  await within(dialog()).findByText("waiting for Ollama…");
  expect(open).toHaveBeenCalledWith("https://ollama.com/download", "_blank", "noopener,noreferrer");
  const link = within(dialog()).getByRole("link", { name: "Open ollama.com/download" });
  expect(link.getAttribute("href")).toBe("https://ollama.com/download");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(link.getAttribute("target")).toBe("_blank");

  state.listing = { ...TWO_READY };
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  vi.useRealTimers();
  await within(dialog()).findByText(/Pick a model · Ollama/);
  expect(fake.raw.startOllama).toHaveBeenCalled();
});

test("the website choice opens the page in a new tab and waits", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const { user } = mount(FRESH_LISTING);
  await found();
  await user.click(choice(/On this Mac/));
  const website = within(dialog()).getByRole("link", { name: /Open ollama.com\/download instead/ });
  expect(website.getAttribute("rel")).toBe("noopener noreferrer");
  await user.click(website);
  await within(dialog()).findByText("waiting for Ollama…");
  expect(open).toHaveBeenCalledWith("https://ollama.com/download", "_blank", "noopener,noreferrer");
});

// Key

function mockClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

test("Key shows the command with Copy, and Check again reports done only once the key exists", async () => {
  const { fake, state, user } = mount(FRESH_LISTING);
  const writeText = mockClipboard();
  await found();
  await user.click(choice(/With an API key/));
  await user.click(choice(/Anthropic/));
  const open = await within(dialog()).findByText("Anthropic · API key");
  expect(open).toBeTruthy();
  expect(within(dialog()).getByText("golem auth set anthropic")).toBeTruthy();
  await user.click(within(dialog()).getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("golem auth set anthropic");
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();

  // Before the key is stored the panel stays.
  await user.click(choice("Check again"));
  await within(dialog()).findByText("the key isn't there yet");
  expect(within(dialog()).getByText("Anthropic · API key")).toBeTruthy();

  // After it, the listing says the provider is ready, and the panel is done.
  state.listing = KEYED_LISTING;
  await user.click(choice("Check again"));
  await within(dialog()).findByText(/Pick a model · Anthropic/);
  expect(steps()?.textContent).toContain("Model (current step)");
});

test("a key already saved says so, shows no command, and Continue goes on", async () => {
  const { user } = mount({ ...FRESH_LISTING, providers: [...FRESH_LISTING.providers.filter((each) => each.provider !== "openai"), { provider: "openai", status: "ready" }], setup: { ...FRESH_LISTING.setup, keys: ["openai"] } });
  await found();
  await user.click(choice(/With an API key/));
  await user.click(choice(/OpenAI/));
  await within(dialog()).findByText("Key saved for OpenAI.");
  expect(within(dialog()).queryByRole("button", { name: "Copy" })).toBeNull();
  expect(dialog().textContent).not.toContain("golem auth set");
  expect(within(dialog()).queryByRole("button", { name: "Check again" })).toBeNull();
  await user.click(choice("Continue"));
  await within(dialog()).findByText(/Pick a model/);
});

test("a page never takes a key: the Key panel has no field", async () => {
  const { user } = mount(FRESH_LISTING);
  await found();
  await user.click(choice(/With an API key/));
  await user.click(choice(/Anthropic/));
  await within(dialog()).findByText("Anthropic · API key");
  expect(within(dialog()).queryByRole("textbox")).toBeNull();
  expect(dialog().querySelector("input")).toBeNull();
});

// Model

test("a download shows its bar and numbers, and goes on to Ready when it ends", async () => {
  const { fake, state, user } = mount(RUNNING_LISTING);
  await found();
  await user.click(choice(/On this Mac/));
  await user.click(choice(/Gemma 4 E4B/));
  await within(dialog()).findByText("downloading Gemma 4 E4B");
  act(() => {
    fake.emitPull({ kind: "progress", progress: { ref: "ollama/gemma4:e4b", status: "pulling", completed: 2_100_000_000, total: 6_600_000_000, progress: 0.32 } });
  });
  const bar = await within(dialog()).findByRole("progressbar", { name: "Downloading Gemma 4 E4B" });
  expect(bar.getAttribute("aria-valuenow")).toBe("31");
  expect(dialog().textContent).toContain("2.1 / 6.6 GB");
  expect(within(dialog()).getByText("Esc keeps it downloading and closes")).toBeTruthy();
  state.listing = WORKING_LISTING;
  act(() => {
    fake.emitPull({ kind: "done", done: { ref: "ollama/gemma4:e4b", ok: true } });
  });
  await within(dialog()).findByText("golem is ready");
  expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/gemma4:e4b");
});

test("a failed download shows its line and goes back to the list", async () => {
  const { fake, user } = mount(RUNNING_LISTING);
  await found();
  await user.click(choice(/On this Mac/));
  await user.click(choice(/Gemma 4 E4B/));
  await within(dialog()).findByText("downloading Gemma 4 E4B");
  act(() => {
    fake.emitPull({ kind: "progress", progress: { ref: "ollama/gemma4:e4b", status: "pulling", completed: 1_000_000, total: 6_600_000_000, progress: 0.01 } });
  });
  act(() => {
    fake.emitPull({ kind: "done", done: { ref: "ollama/gemma4:e4b", ok: false, error: "no space left on device" } });
  });
  await within(dialog()).findByText("download of ollama/gemma4:e4b failed");
  expect(within(dialog()).getByText("no space left on device")).toBeTruthy();
  expect(choice(/Gemma 4 E4B/)).toBeTruthy();
});

test("a download the daemon refuses shows why", async () => {
  const { fake, user } = mount(RUNNING_LISTING);
  fake.raw.pullModel.mockRejectedValue(new Error("model not found"));
  await found();
  await user.click(choice(/On this Mac/));
  await user.click(choice(/Gemma 4 E4B/));
  await within(dialog()).findByText("download of ollama/gemma4:e4b failed");
  expect(within(dialog()).getByText("model not found")).toBeTruthy();
});

test("Esc during a download closes the window, and the download stays in the pulls store", async () => {
  const { page, fake, user } = mount(RUNNING_LISTING);
  await found();
  await user.click(choice(/On this Mac/));
  await user.click(choice(/Gemma 4 E4B/));
  await within(dialog()).findByText("downloading Gemma 4 E4B");
  act(() => {
    fake.emitPull({ kind: "progress", progress: { ref: "ollama/gemma4:e4b", status: "pulling", completed: 1_000_000, total: 6_600_000_000, progress: 0.01 } });
  });
  await user.keyboard("{Escape}");
  await waitFor(closed);
  expect(page.pulls.getSnapshot().active.has("ollama/gemma4:e4b")).toBe(true);
});

async function backgroundDownload() {
  const view = mount(RUNNING_LISTING);
  await found();
  await view.user.click(choice(/On this Mac/));
  await view.user.click(choice(/Gemma 4 E4B/));
  await within(dialog()).findByText("downloading Gemma 4 E4B");
  act(() => {
    view.fake.emitPull({ kind: "progress", progress: { ref: "ollama/gemma4:e4b", status: "pulling", completed: 1_000_000, total: 6_600_000_000, progress: 0.01 } });
  });
  await view.user.keyboard("{Escape}");
  await waitFor(closed);
  expect(view.fake.raw.setDefaultModel).not.toHaveBeenCalled();
  return view;
}

test("a download sent to the background makes its model the default when it finishes", async () => {
  const { fake } = await backgroundDownload();
  act(() => {
    fake.emitPull({ kind: "done", done: { ref: "ollama/gemma4:e4b", ok: true } });
  });
  await waitFor(() => expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/gemma4:e4b"));
});

test("a download sent to the background sets no default when it fails", async () => {
  const { fake } = await backgroundDownload();
  act(() => {
    fake.emitPull({ kind: "done", done: { ref: "ollama/gemma4:e4b", ok: false, error: "no space left on device" } });
  });
  await wait();
  expect(fake.raw.setDefaultModel).not.toHaveBeenCalled();
});

test("using an installed model makes it the default", async () => {
  const { fake, user } = mount(TWO_READY);
  await found();
  await user.click(choice(/On this Mac/));
  await user.click(choice(/Qwen3 8B/));
  await within(dialog()).findByText("golem is ready");
  expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/qwen3:8b");
});

test("the Model panel alone, after a gone default, goes back to where it came from", async () => {
  const { fake, user } = mount(GONE_LISTING);
  await within(await found()).findByText(/no longer installed/);
  await user.click(choice(/Gemma 4 E4B/));
  expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/gemma4:e4b");
  await waitFor(closed);
});

// The overview

test("the overview's fix opens one panel alone and returns to the overview", async () => {
  const { user } = mount(WORKING_LISTING, { rows: OK_ROWS });
  await user.click(box());
  await user.type(box(), "/setup{Enter}");
  await found();
  await user.click(await within(dialog()).findByRole("button", { name: "Change model" }));
  await within(dialog()).findByText(/Pick a model/);
  expect(steps()).toBeNull();
  await user.keyboard("{Escape}");
  await within(dialog()).findByText("Change model");
});

test("Run setup again walks guided mode from Service, with the Service panel naming the command when it is not kept", async () => {
  const rows = STATUS_ROWS.map((row) => (row.part === "service" ? { ...row, state: "fail" as const, detail: "launchd has no golem job" } : row));
  const { user } = mount(WORKING_LISTING, { rows });
  await user.click(box());
  await user.type(box(), "/setup{Enter}");
  const open = await found();
  expect(await within(open).findByText(/running · v0\.5\.0 · not kept at login/)).toBeTruthy();
  await user.click(within(open).getByRole("button", { name: "Run setup again" }));
  await within(dialog()).findByText("service running");
  expect(within(dialog()).getByText("golem daemon install")).toBeTruthy();
  expect(within(dialog()).getByRole("button", { name: "Copy" })).toBeTruthy();
  await user.click(choice("Continue"));
  await within(dialog()).findByText("Where should golem think?");
});

test("a service kept at login has nothing to copy", async () => {
  const { user } = mount(WORKING_LISTING, { rows: OK_ROWS });
  await user.click(box());
  await user.type(box(), "/setup{Enter}");
  await found();
  await within(dialog()).findByText("Run setup again");
  await user.click(choice("Run setup again"));
  await within(dialog()).findByText("service running");
  expect(within(dialog()).queryByRole("button", { name: "Copy" })).toBeNull();
  expect(dialog().textContent).toContain("starts at login");
});

// Accessibility, both themes

for (const theme of ["slip", "kiln"]) {
  test(`no accessibility violations on the overview, Engine, Ollama, Key, a download, and Ready in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    // The overview.
    const overview = mount(WORKING_LISTING, { rows: OK_ROWS });
    await overview.user.click(box());
    await overview.user.type(box(), "/setup{Enter}");
    await found();
    await within(dialog()).findByText("Change model");
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    overview.unmount();
    closeSetup();

    // Engine, Ollama, Key.
    const guidedRun = mount(FRESH_LISTING);
    await found();
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    await guidedRun.user.click(choice(/On this Mac/));
    await within(dialog()).findByText("Ollama isn't installed");
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    await guidedRun.user.click(within(dialog()).getByRole("button", { name: "Back" }));
    await guidedRun.user.click(choice(/With an API key/));
    await guidedRun.user.click(choice(/Anthropic/));
    await within(dialog()).findByText("Anthropic · API key");
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    guidedRun.unmount();
    closeSetup();

    // A download, then Ready.
    const download = mount(RUNNING_LISTING);
    await found();
    await download.user.click(choice(/On this Mac/));
    await download.user.click(choice(/Gemma 4 E4B/));
    await within(dialog()).findByText("downloading Gemma 4 E4B");
    act(() => {
      download.fake.emitPull({ kind: "progress", progress: { ref: "ollama/gemma4:e4b", status: "pulling", completed: 2_100_000_000, total: 6_600_000_000, progress: 0.32 } });
    });
    await within(dialog()).findByRole("progressbar");
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    download.state.listing = WORKING_LISTING;
    act(() => {
      download.fake.emitPull({ kind: "done", done: { ref: "ollama/gemma4:e4b", ok: true } });
    });
    await within(dialog()).findByText("golem is ready");
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  });
}
