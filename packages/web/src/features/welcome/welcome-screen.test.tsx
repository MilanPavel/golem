import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import type { ModelListResult, SetupRow } from "../../store/models.ts";
import { createPageHost } from "../../store/page-host.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { createPage } from "../../store/page.ts";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { FRESH_LISTING, GONE_LISTING, KEYED_LISTING, OK_ROWS, RUNNING_LISTING, STATUS_ROWS, STOPPED_LISTING, WORKING_LISTING } from "../setup/sample.ts";
import { startNoticeStore } from "../setup/start-notice.ts";
import { resetWelcome } from "./welcome-store.ts";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const here = () => location.pathname + location.search;

type Options = { path?: string; rows?: SetupRow[]; pageKept?: boolean };

function mount(listing: ModelListResult, { path = "/", rows = OK_ROWS, pageKept = true }: Options = {}) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  const state = { listing };
  fake.raw.listModels.mockImplementation(async () => state.listing);
  fake.raw.setupStatus.mockResolvedValue({ rows });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc, pageHost: createPageHost(async () => ({ kept: pageKept })) });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  /** The daemon's listing changed: the page reads it again. */
  const relist = async (next: ModelListResult) => {
    state.listing = next;
    await act(async () => {
      await page.actions.refreshModels();
    });
  };
  return { fake, page, state, relist, user: userEvent.setup(), ...view };
}

const heading = (name: string | RegExp) => screen.findByRole("heading", { level: 2, name });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const continueButton = () => screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
const strip = () => screen.queryByText("Setup isn't finished.");

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
  vi.useRealTimers();
});

// What the start does

test("a fresh home goes to /welcome, laid out without the sidebar", async () => {
  mount(FRESH_LISTING);
  await screen.findByRole("heading", { level: 1, name: "Welcome to golem" });
  expect(here()).toBe("/welcome");
  expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull();
  expect(within(screen.getByRole("list", { name: "Setup steps" })).getByText("current step")).toBeTruthy();
});

test("a default that is gone goes to /welcome?step=model and names it", async () => {
  mount(GONE_LISTING);
  await heading("Pick a model");
  expect(here()).toBe("/welcome?step=model");
  expect(screen.getByRole("status").textContent).toBe("!Your default model ollama/qwen3:8b is no longer installed. Pick another to keep chatting.");
  const steps = screen.getByRole("list", { name: "Setup steps" });
  expect(within(steps).getByRole("button", { name: "Engine, done. Go back to it" })).toBeTruthy();
  expect(within(steps).getByText("skipped")).toBeTruthy();
});

test("a working setup stays on home, with no strip", async () => {
  const { fake } = mount(WORKING_LISTING);
  await waitFor(() => expect(fake.raw.listModels).toHaveBeenCalled());
  await wait();
  expect(here()).toBe("/");
  expect(strip()).toBeNull();
});

test("the only model ready, with no default, becomes the default and nothing opens", async () => {
  const one: ModelListResult = {
    ...RUNNING_LISTING,
    models: RUNNING_LISTING.models.map((each, index) => (index === 0 ? { ...each, status: "ready" as const, source: "installed" as const } : each)),
  };
  const { fake } = mount(one);
  await waitFor(() => expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/gemma4:e4b"));
  await screen.findByText("Using ollama/gemma4:e4b, the only model ready. /setup to change.");
  expect(here()).toBe("/");
});

test("the start runs once per page load: Later stays on home, and a reconnect does not send it back", async () => {
  const { fake, user } = mount(FRESH_LISTING);
  await screen.findByRole("heading", { level: 1, name: "Welcome to golem" });
  await user.click(button("Later"));
  expect(here()).toBe("/");
  act(() => fake.setState({ status: "reconnecting", attempt: 1, delayMs: 1000 }));
  await wait();
  act(() => fake.setState({ status: "connected" }));
  await wait();
  await wait();
  expect(here()).toBe("/");
});

test("a page opened on /welcome stays at the step its address names", async () => {
  const { fake } = mount(FRESH_LISTING, { path: "/welcome?step=ready" });
  await waitFor(() => expect(fake.raw.listModels).toHaveBeenCalled());
  await wait();
  expect(here()).toBe("/welcome?step=ready");
  await heading("golem is ready.");
});

// Engine

test("Ollama running: Continue is enabled and has focus, and goes to Model", async () => {
  const { user } = mount(RUNNING_LISTING, { path: "/welcome" });
  await screen.findByText("Running · no models yet");
  await waitFor(() => expect(document.activeElement).toBe(continueButton()));
  await user.keyboard("{Enter}");
  await heading("Pick a model");
  expect(here()).toBe("/welcome?step=model");
});

test("Install Ollama streams its output in the card, and a finished install starts Ollama and enables Continue", async () => {
  const { fake, relist, user } = mount(FRESH_LISTING, { path: "/welcome" });
  await user.click(await screen.findByRole("button", { name: "Install Ollama" }));
  await waitFor(() => expect(fake.raw.installOllama).toHaveBeenCalledTimes(1));
  await screen.findByText("Installing with Homebrew…");
  act(() => fake.emitInstall({ kind: "output", text: "==> Pouring ollama-0.12\nPartial" }));
  expect(await screen.findByText(/==> Pouring ollama-0.12/)).toBeTruthy();
  expect(button("Stop")).toBeTruthy();
  expect(continueButton().disabled).toBe(true);
  await relist(RUNNING_LISTING);
  act(() => fake.emitInstall({ kind: "done", done: { outcome: "installed" } }));
  await waitFor(() => expect(fake.raw.startOllama).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(continueButton().disabled).toBe(false));
});

test("Stop cancels the install", async () => {
  const { fake, user } = mount(FRESH_LISTING, { path: "/welcome" });
  await user.click(await screen.findByRole("button", { name: "Install Ollama" }));
  await user.click(await screen.findByRole("button", { name: "Stop" }));
  expect(fake.raw.cancelOllamaInstall).toHaveBeenCalledTimes(1);
});

test("with no Homebrew: Download Ollama in a new tab, Check again, and the page checks every 5 s while the tab is visible", async () => {
  const { RpcError, OLLAMA_FAILED } = await import("@golem/client");
  const { fake, user } = mount(FRESH_LISTING, { path: "/welcome" });
  fake.raw.installOllama.mockRejectedValue(new RpcError(OLLAMA_FAILED, "no Homebrew", { no_brew: true }));
  const install = await screen.findByRole("button", { name: "Install Ollama" });
  // The page's own timer starts when the card shows, so the clock is faked before that.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  await user.click(install);
  await screen.findByText("Not installed, and Homebrew isn't here to install it.");
  const link = screen.getByRole("link", { name: /Download Ollama/ });
  expect(link.getAttribute("href")).toBe("https://ollama.com/download");
  expect(link.getAttribute("target")).toBe("_blank");
  const calls = () => fake.raw.listModels.mock.calls.length;
  await user.click(button("Check again"));
  await wait();
  const before = calls();
  expect(before).toBeGreaterThan(1);
  // Not yet five seconds: no new look.
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(calls()).toBe(before);
  fake.raw.listModels.mockImplementation(async () => RUNNING_LISTING);
  await act(async () => {
    vi.advanceTimersByTime(1500);
  });
  await wait();
  expect(calls()).toBeGreaterThan(before);
  await screen.findByText("Running · no models yet");
  expect(continueButton().disabled).toBe(false);
});

test("a stopped Ollama is started with a button", async () => {
  const { fake, relist, user } = mount(STOPPED_LISTING, { path: "/welcome" });
  await user.click(await screen.findByRole("button", { name: "Start Ollama" }));
  await relist(RUNNING_LISTING);
  await waitFor(() => expect(fake.raw.startOllama).toHaveBeenCalledTimes(1));
  await screen.findByText("Running · no models yet");
});

test("With an API key: the command to copy, no field for a key, and the page checks again when the tab gets focus back", async () => {
  const { fake, state, user } = mount(FRESH_LISTING, { path: "/welcome" });
  await user.click(await screen.findByRole("button", { name: /With an API key/ }));
  expect(await screen.findByText("golem auth set anthropic")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(continueButton().disabled).toBe(true);
  await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "openai");
  expect(screen.getByText("golem auth set openai")).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "anthropic");
  // The key was set in a terminal; coming back to the tab looks again.
  const calls = fake.raw.listModels.mock.calls.length;
  state.listing = KEYED_LISTING;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(fake.raw.listModels.mock.calls.length).toBeGreaterThan(calls));
  await screen.findByText("Key saved in your macOS Keychain.");
  await waitFor(() => expect(continueButton().disabled).toBe(false));
});

// Model, Ready, and the start of chat

test("Model waits for a default, then Ready says what was set up, and Start chatting goes home", async () => {
  const { relist, user } = mount(RUNNING_LISTING, { path: "/welcome?step=model" });
  await heading("Pick a model");
  expect(continueButton().disabled).toBe(true);
  await user.click(button("Choose a model…"));
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  await relist(WORKING_LISTING);
  await screen.findByText("gemma4:e4b · default");
  await user.click(continueButton());
  await heading("golem is ready.");
  expect(here()).toBe("/welcome?step=ready");
  const list = screen.getByRole("list", { name: "What was set up" });
  expect(list.textContent).toContain("Ollama on this Mac");
  expect(list.textContent).toContain("gemma4:e4b · default");
  expect(list.textContent).toContain("skipped");
  expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
  await user.click(button("Start chatting"));
  expect(here()).toBe("/");
  expect(strip()).toBeNull();
});

test("a done step goes back to it", async () => {
  const { user } = mount(WORKING_LISTING, { path: "/welcome?step=ready" });
  await heading("golem is ready.");
  await user.click(screen.getByRole("button", { name: "Model, done. Go back to it" }));
  await heading("Pick a model");
  expect(here()).toBe("/welcome?step=model");
  await user.click(screen.getByRole("button", { name: "Engine, done. Go back to it" }));
  await heading("How should golem think?");
  expect(here()).toBe("/welcome");
});

const PULL = { ref: "ollama/gemma4:e4b", status: "pulling", completed: 2_100_000_000, total: 6_600_000_000, progress: 0.32 };

test("Ready while the default downloads says Almost ready, and turns into golem is ready by itself when it ends", async () => {
  const { fake, state, user } = mount(RUNNING_LISTING, { path: "/welcome?step=model" });
  await heading("Pick a model");
  act(() => fake.emitPull({ kind: "progress", progress: PULL }));
  await screen.findByRole("progressbar", { name: "Downloading gemma4:e4b" });
  await user.click(continueButton());
  await heading("Almost ready.");
  const model = within(screen.getByRole("list", { name: "What was set up" })).getAllByRole("listitem")[1] as HTMLElement;
  expect(within(model).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("31");
  expect((button("Start chatting") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
  // The download ends: the model becomes the default, and the page says so by itself.
  fake.raw.setDefaultModel.mockImplementation(async () => {
    // The daemon has it as the default now; the page reads the list again when `setDefault` returns.
    state.listing = WORKING_LISTING;
    return {} as never;
  });
  act(() => fake.emitPull({ kind: "done", done: { ref: "ollama/gemma4:e4b", ok: true } }));
  await waitFor(() => expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("ollama/gemma4:e4b"));
  await heading("golem is ready.");
  await waitFor(() => expect((button("Start chatting") as HTMLButtonElement).disabled).toBe(false));
});

test("Ready names how to keep golem running when the service is not kept at login, and never blocks", async () => {
  const kept = STATUS_ROWS.map((row) => (row.part === "service" ? { ...row, state: "warn" as const } : row));
  const { user } = mount(WORKING_LISTING, { path: "/welcome?step=ready", rows: kept });
  await screen.findByText("golem and this page stop when you close the terminal window. To keep them running, even after a restart:");
  expect(screen.getByText("golem install")).toBeTruthy();
  expect((button("Start chatting") as HTMLButtonElement).disabled).toBe(false);
  await user.click(button("Start chatting"));
  expect(here()).toBe("/");
});

test("Ready has no note when the service is kept", async () => {
  mount(WORKING_LISTING, { path: "/welcome?step=ready", rows: OK_ROWS });
  await heading("golem is ready.");
  await wait();
  expect(screen.queryByText(/stop when you close the terminal window/)).toBeNull();
});

test("Ready names `golem web install` when only the page's gateway is not kept", async () => {
  mount(WORKING_LISTING, { path: "/welcome?step=ready", rows: OK_ROWS, pageKept: false });
  await screen.findByText("This page stops when you close the terminal window. To keep it running, even after a restart:");
  expect(screen.getByText("golem web install")).toBeTruthy();
  expect((button("Start chatting") as HTMLButtonElement).disabled).toBe(false);
});

test("Ready names `golem install` for both when neither is kept", async () => {
  const unkept = STATUS_ROWS.map((row) => (row.part === "service" ? { ...row, state: "warn" as const } : row));
  mount(WORKING_LISTING, { path: "/welcome?step=ready", rows: unkept, pageKept: false });
  await screen.findByText("golem and this page stop when you close the terminal window. To keep them running, even after a restart:");
  expect(screen.getByText("golem install")).toBeTruthy();
});

test("from a send: the lede says nothing was sent, and the button goes back where the person came from", async () => {
  const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
  const { user } = mount(WORKING_LISTING, { path: "/welcome?step=ready&from=send" });
  await heading("golem is ready.");
  expect(screen.getByText("Your message is waiting where you left it. Nothing has been sent.")).toBeTruthy();
  // The origin is kept as the person moves through the steps.
  await user.click(screen.getByRole("button", { name: "Model, done. Go back to it" }));
  expect(here()).toBe("/welcome?step=model&from=send");
  await user.click(continueButton());
  await user.click(await screen.findByRole("button", { name: "Back to your message" }));
  expect(back).toHaveBeenCalledTimes(1);
});

// Later, and the strip on home

test("Later goes home and leaves the strip, Finish setup goes back to the step that was left, and the strip goes once a default is ready", async () => {
  const { fake, page, relist, user } = mount(RUNNING_LISTING, { path: "/welcome?step=model" });
  await heading("Pick a model");
  act(() => fake.emitPull({ kind: "progress", progress: PULL }));
  await screen.findByRole("progressbar", { name: "Downloading gemma4:e4b" });
  await user.click(button("Later"));
  expect(here()).toBe("/");
  await screen.findByText("Setup isn't finished.");
  expect(screen.getByText(/Chats start once a model is ready\./)).toBeTruthy();
  // The download keeps running.
  expect(page.pulls.getSnapshot().active.has("ollama/gemma4:e4b")).toBe(true);
  await user.click(button("Finish setup"));
  expect(here()).toBe("/welcome?step=model");
  await heading("Pick a model");
  await user.click(button("Later"));
  await screen.findByText("Setup isn't finished.");
  await relist(WORKING_LISTING);
  await waitFor(() => expect(strip()).toBeNull());
});

test("Later at Engine comes back to Engine", async () => {
  const { user } = mount(FRESH_LISTING, { path: "/welcome" });
  await screen.findByRole("heading", { level: 1, name: "Welcome to golem" });
  await user.click(button("Later"));
  await screen.findByText("Setup isn't finished.");
  await user.click(button("Finish setup"));
  expect(here()).toBe("/welcome");
  await screen.findByRole("heading", { level: 2, name: "How should golem think?" });
});
