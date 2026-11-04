import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { ModelListResult } from "../../store/models.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { rpcError, ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { NO_OLLAMA_LISTING, OLLAMA_DOWN_LISTING, SAMPLE_LISTING } from "./sample.ts";

const popup = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const CWD = "/Users/you/repos/golem";
const QWEN = "ollama/qwen3:8b";
const GEMMA = "ollama/gemma4:e4b";
const BIG = "ollama/qwen3:32b";
const MID = "ollama/qwen3:14b";

async function setup(listing: ModelListResult | Error = SAMPLE_LISTING) {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
  if (listing instanceof Error) fake.raw.listModels.mockRejectedValue(listing);
  else fake.raw.listModels.mockResolvedValue(listing);
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
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  act(() => {
    fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_name: "qwen3:8b", title: "UTF-8 split" }));
  });
  return { fake, page, ...view };
}

const chip = () => screen.getByRole("button", { name: /^Model: / });
const dialog = () => screen.getByRole("dialog", { name: "Choose a model" });
const search = () => within(dialog()).getByRole("combobox", { name: "Search models" }) as HTMLInputElement;
const options = () => within(dialog()).getAllByRole("option");
const optionOf = (name: string) => options().find((option) => option.textContent?.includes(name)) as HTMLElement;
const active = () => options().find((option) => option.getAttribute("aria-selected") === "true");

async function openDialog(listing: ModelListResult | Error = SAMPLE_LISTING) {
  const empty = !(listing instanceof Error) && listing.models.length === 0;
  const view = await setup(listing);
  const user = userEvent.setup();
  await user.click(chip());
  await screen.findByRole("dialog", { name: "Choose a model" });
  if (!(listing instanceof Error) && !empty) await screen.findAllByRole("option");
  if (empty) await within(dialog()).findByText("No models found.");
  return { ...view, user };
}

async function pick(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(optionOf(name));
  expect(active()).toBe(optionOf(name));
}

beforeEach(() => {
  localStorage.clear();
  drawerOpenStore.set(true);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("the chip is a button named for the model that opens the dialog", async () => {
  await setup();
  expect(chip().getAttribute("aria-label")).toBe("Model: qwen3:8b");
  expect(chip().getAttribute("aria-haspopup")).toBe("dialog");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the dialog says what the session and new sessions use", async () => {
  await openDialog();
  expect(dialog().textContent).toContain("This session uses qwen3:8b. New sessions use ollama/gemma4:e4b.");
});

test("it says when there is no default yet", async () => {
  await openDialog({ ...SAMPLE_LISTING, default: null });
  expect(dialog().textContent).toContain("No default yet.");
});

test("models are grouped as the TUI groups them, each group named by its heading", async () => {
  await openDialog();
  const listbox = within(dialog()).getByRole("listbox");
  const groups = within(listbox).getAllByRole("group");
  expect(groups.map((group) => group.getAttribute("aria-labelledby")).every((id) => id !== null)).toBe(true);
  expect(groups.map((group) => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
    "Profiles",
    "Installed",
    "Download",
    "groq",
    "lmstudio",
    "openrouter",
  ]);
  expect(within(groups[0]!).getAllByRole("option").map((option) => option.textContent)).toEqual([
    expect.stringContaining("local"),
    expect.stringContaining("sonnet"),
  ]);
  expect(within(groups[2]!).getAllByRole("option")).toHaveLength(3);
});

test("the search field is a combobox over the list, and focus stays in it", async () => {
  const { user } = await openDialog();
  const box = search();
  expect(document.activeElement).toBe(box);
  const listbox = within(dialog()).getByRole("listbox");
  expect(box.getAttribute("aria-controls")).toBe(listbox.id);
  expect(box.getAttribute("aria-expanded")).toBe("true");
  expect(box.getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
  expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
  await user.click(optionOf("Qwen3 14B"));
  expect(document.activeElement).toBe(box);
  expect(box.getAttribute("aria-activedescendant")).toBe(optionOf("Qwen3 14B").id);
});

test("typing filters the list and the active row stays when it still matches", async () => {
  const { user } = await openDialog();
  await pick(user, "Qwen3 14B");
  await user.type(search(), "qwen3");
  expect(options().map((option) => option.textContent)).toEqual([
    expect.stringContaining("qwen3:8b"),
    expect.stringContaining("Qwen3 14B"),
    expect.stringContaining("Qwen3 32B"),
    expect.stringContaining("Qwen3 235B"),
  ]);
  expect(active()).toBe(optionOf("Qwen3 14B"));
  await user.type(search(), ":8");
  expect(options()).toHaveLength(1);
  expect(active()).toBe(options()[0]);
  await user.clear(search());
  await user.type(search(), "zzz");
  expect(screen.queryByRole("option")).toBeNull();
  expect(within(dialog()).getByText("No matching models.")).toBeTruthy();
  expect(search().getAttribute("aria-expanded")).toBe("false");
});

test("the arrow keys, Home, End, and the page keys move the active row and stop at the ends", async () => {
  const { user } = await openDialog();
  const names = options().map((option) => option.id);
  expect(names).toHaveLength(9);
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(active()!.id).toBe(names[2]);
  await user.keyboard("{ArrowUp}");
  expect(active()!.id).toBe(names[1]);
  await user.keyboard("{End}");
  expect(active()!.id).toBe(names[8]);
  await user.keyboard("{ArrowDown}");
  expect(active()!.id).toBe(names[8]);
  await user.keyboard("{Home}");
  expect(active()!.id).toBe(names[0]);
  await user.keyboard("{ArrowUp}");
  expect(active()!.id).toBe(names[0]);
  await user.keyboard("{PageDown}");
  expect(active()!.id).toBe(names[8]);
  await user.keyboard("{PageUp}");
  expect(active()!.id).toBe(names[0]);
  expect(document.activeElement).toBe(search());
});

test("the current model carries a check and the word current, the default a badge", async () => {
  await openDialog();
  const current = optionOf("local");
  expect(within(current).getByText("current").className).toContain("sr-only");
  expect(within(current).queryByText("default")).toBeNull();
  const standard = optionOf("Gemma 4 E4B");
  expect(within(standard).getByText("default")).toBeTruthy();
  expect(within(standard).queryByText("current")).toBeNull();
  expect(within(current).getByText(QWEN)).toBeTruthy();
});

test("a row shows its facts", async () => {
  await openDialog();
  expect(optionOf("local").textContent).toContain("41k  free  5.2 GB fits");
  expect(optionOf("Qwen3 14B").textContent).toContain("41k  free  9.3 GB fits  download");
  expect(optionOf("Qwen3 235B").textContent).toContain("131k  $0.2/0.6");
});

test("a model that is not ready says why", async () => {
  const { user } = await openDialog();
  expect(optionOf("sonnet").textContent).toContain("Needs a key: run golem auth set anthropic");
  expect(optionOf("Qwen3 14B").textContent).toContain("Not downloaded yet");
  expect(optionOf("Qwen2.5 7B").textContent).toContain("lmstudio is not answering.");
  expect(within(optionOf("sonnet")).getByText("golem auth set anthropic").tagName).toBe("CODE");
  await pick(user, "sonnet");
  expect(within(dialog()).queryByRole("button", { name: "Use for this session" })).toBeNull();
  expect(within(dialog()).queryByRole("button", { name: "Download" })).toBeNull();
});

test("provider notes follow the list", async () => {
  await openDialog();
  const notes = within(dialog()).getAllByRole("listitem").map((item) => item.textContent);
  expect(notes).toEqual([
    "groq: run golem auth set groq to list its models",
    "lmstudio: not answering",
  ]);
});

test("with Ollama down, its models say to run ollama serve", async () => {
  await openDialog(OLLAMA_DOWN_LISTING);
  expect(optionOf("Qwen3 8B").textContent).toContain("Ollama is not answering. Run ollama serve.");
  expect(within(dialog()).getByText("ollama: not answering")).toBeTruthy();
});

test("with Ollama missing, a download says to run golem, then /setup", async () => {
  const { user } = await openDialog(NO_OLLAMA_LISTING);
  expect(optionOf("Qwen3 8B").textContent).toContain("Ollama is not installed. Run golem, then /setup.");
  expect(optionOf("Qwen3 8B").textContent).toContain("install");
  expect(within(dialog()).getByText("ollama: not installed")).toBeTruthy();
  await pick(user, "Qwen3 8B");
  expect(within(dialog()).queryByRole("button", { name: "Download" })).toBeNull();
});

test("Use for this session switches, closes, and leaves the chip to the daemon's event", async () => {
  const { fake, user } = await openDialog();
  await pick(user, "Gemma 4 E4B");
  await user.click(within(dialog()).getByRole("button", { name: "Use for this session" }));
  expect(fake.raw.setSessionModel).toHaveBeenCalledWith("a", GEMMA);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(chip().getAttribute("aria-label")).toBe("Model: qwen3:8b");
  act(() => {
    fake.emitEvent(ev("a", "model.selected", { model_profile: GEMMA, model_provider: "ollama", model_name: "gemma4:e4b" }));
  });
  expect(chip().getAttribute("aria-label")).toBe("Model: gemma4:e4b");
});

test("a profile is sent by its name", async () => {
  const { fake, user } = await openDialog();
  await pick(user, "sonnet");
  await user.click(optionOf("Qwen3 235B"));
  await user.click(within(dialog()).getByRole("button", { name: "Use for this session" }));
  expect(fake.raw.setSessionModel).toHaveBeenCalledWith("a", "openrouter/qwen/qwen3-235b");
});

test("Enter does the primary action, and the current model has none", async () => {
  const { fake, user } = await openDialog();
  await user.keyboard("{Enter}");
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
  expect(within(dialog()).getByRole("button", { name: "In use" }).hasAttribute("disabled")).toBe(true);
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(fake.raw.setSessionModel).toHaveBeenCalledWith("a", GEMMA);
});

test("a double click does the primary action", async () => {
  const { fake, user } = await openDialog();
  await user.dblClick(optionOf("Gemma 4 E4B"));
  expect(fake.raw.setSessionModel).toHaveBeenCalledWith("a", GEMMA);
});

test("Make default keeps the dialog open and fetches the list again", async () => {
  const { fake, user } = await openDialog();
  expect(fake.raw.listModels).toHaveBeenCalledTimes(1);
  await user.click(within(dialog()).getByRole("button", { name: "Make default" }));
  expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("local");
  await waitFor(() => expect(fake.raw.listModels).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("dialog", { name: "Choose a model" })).toBeTruthy();
});

test("the default model's button says Default and is off", async () => {
  const { user } = await openDialog();
  await pick(user, "Gemma 4 E4B");
  const button = within(dialog()).getByRole("button", { name: "Default" });
  expect(button.hasAttribute("disabled")).toBe(true);
});

test("Download asks first, naming the size and fit, then downloads and uses it", async () => {
  const { fake, page, user } = await openDialog();
  await pick(user, "Qwen3 14B");
  await user.click(within(dialog()).getByRole("button", { name: "Download" }));
  const ask = within(dialog()).getByRole("group", { name: "Confirm" });
  expect(ask.textContent).toContain("Download qwen3:14b (9.3 GB, fits) and use it?");
  expect(document.activeElement).toBe(within(ask).getByRole("button", { name: "Download" }));
  expect(fake.raw.pullModel).not.toHaveBeenCalled();
  await user.click(within(ask).getByRole("button", { name: "Download" }));
  expect(fake.raw.pullModel).toHaveBeenCalledWith(MID);
  await waitFor(() => expect(within(dialog()).queryByRole("group", { name: "Confirm" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Choose a model" })).toBeTruthy();
  expect(optionOf("Qwen3 14B").textContent).toContain("starting…");
  expect(within(dialog()).getByRole("button", { name: "Stop download" })).toBeTruthy();
  expect(page.pulls.getSnapshot().active.has(MID)).toBe(true);
});

test("Cancel in the question keeps the dialog and returns focus to the search field", async () => {
  const { fake, user } = await openDialog();
  await pick(user, "Qwen3 14B");
  await user.click(within(dialog()).getByRole("button", { name: "Download" }));
  await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
  expect(within(dialog()).queryByRole("group", { name: "Confirm" })).toBeNull();
  expect(within(dialog()).getByRole("button", { name: "Download" })).toBeTruthy();
  expect(document.activeElement).toBe(search());
  expect(fake.raw.pullModel).not.toHaveBeenCalled();
});

test("Esc in the question closes the question, then clears the search, then closes the dialog", async () => {
  const { user } = await openDialog();
  await user.type(search(), "14b");
  await user.click(within(dialog()).getByRole("button", { name: "Download" }));
  expect(within(dialog()).getByRole("group", { name: "Confirm" })).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(within(dialog()).queryByRole("group", { name: "Confirm" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Choose a model" })).toBeTruthy();
  expect(search().value).toBe("14b");
  await user.keyboard("{Escape}");
  expect(search().value).toBe("");
  expect(screen.getByRole("dialog", { name: "Choose a model" })).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a model too big asks twice and warns about the disk", async () => {
  const { fake, user } = await openDialog({ ...SAMPLE_LISTING, disk_free_gb: 12 });
  await pick(user, "Qwen3 32B");
  await user.click(within(dialog()).getByRole("button", { name: "Download" }));
  const ask = () => within(dialog()).getByRole("group", { name: "Confirm" });
  expect(ask().textContent).toContain("qwen3:32b (20 GB) is too big for 16 GB of memory.");
  await user.click(within(ask()).getByRole("button", { name: "Download anyway" }));
  expect(fake.raw.pullModel).not.toHaveBeenCalled();
  expect(ask().textContent).toContain("Download qwen3:32b (20 GB, too big) and use it?");
  expect(ask().textContent).toContain("Only 12 GB free on disk.");
  await user.click(within(ask()).getByRole("button", { name: "Download" }));
  expect(fake.raw.pullModel).toHaveBeenCalledWith(BIG);
});

test("a machine of unknown memory is called this Mac", async () => {
  const { user } = await openDialog({ ...SAMPLE_LISTING, ram_gb: null });
  await pick(user, "Qwen3 32B");
  await user.click(within(dialog()).getByRole("button", { name: "Download" }));
  expect(dialog().textContent).toContain("too big for this Mac.");
});

test("a download started for a session switches it once the download ends well, with the dialog shut", async () => {
  const { fake, user } = await openDialog();
  await pick(user, "Qwen3 14B");
  await user.click(within(dialog()).getByRole("button", { name: "Download" }));
  await user.click(within(dialog()).getByRole("group", { name: "Confirm" }).querySelector("button:last-child") as HTMLElement);
  await waitFor(() => expect(fake.raw.pullModel).toHaveBeenCalled());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(chip());
  act(() => {
    fake.emitPull({ kind: "done", done: { ref: MID, ok: true, error: null } });
  });
  expect(fake.raw.setSessionModel).toHaveBeenCalledWith("a", MID);
});

test("a download started elsewhere shows its progress, speed, and time left", async () => {
  const { fake } = await openDialog();
  act(() => {
    fake.emitPull({ kind: "progress", progress: { ref: "ollama/gemma3:12b", status: "pulling", completed: 1_000_000_000, total: 6_600_000_000, progress: 0.15 } });
  });
  const row = optionOf("Gemma 3 12B");
  expect(row.textContent).toContain("1.0 / 6.6 GB");
  expect(within(row).getByRole("progressbar", { name: "Downloading gemma3:12b" }).getAttribute("aria-valuenow")).toBe("15");
  expect(row.textContent).toContain("downloading 15%");
  expect(row.textContent).not.toContain("Not downloaded yet");
});

test("Stop download asks for no confirmation", async () => {
  const { fake, user } = await openDialog();
  act(() => {
    fake.emitPull({ kind: "progress", progress: { ref: MID, status: "pulling", completed: 10, total: 100, progress: 0.1 } });
  });
  await pick(user, "Qwen3 14B");
  await user.click(within(dialog()).getByRole("button", { name: "Stop download" }));
  expect(fake.raw.cancelPull).toHaveBeenCalledWith(MID);
  expect(within(dialog()).queryByRole("group", { name: "Confirm" })).toBeNull();
});

test("a stopped download is not shown as failed, a failed one shows its error", async () => {
  const { fake } = await openDialog();
  act(() => {
    fake.emitPull({ kind: "progress", progress: { ref: MID, status: "pulling", completed: 10, total: 100, progress: 0.1 } });
    fake.emitPull({ kind: "done", done: { ref: MID, ok: false, error: "cancelled" } });
  });
  expect(optionOf("Qwen3 14B").textContent).not.toContain("failed");
  act(() => {
    fake.emitPull({ kind: "done", done: { ref: MID, ok: false, error: "no space left on device" } });
  });
  expect(optionOf("Qwen3 14B").textContent).toContain("Download failed: no space left on device");
});

test("Remove asks first, naming the size it frees", async () => {
  const { fake, user } = await openDialog();
  await pick(user, "Gemma 4 E4B");
  await user.click(within(dialog()).getByRole("button", { name: "Remove" }));
  const ask = within(dialog()).getByRole("group", { name: "Confirm" });
  expect(ask.textContent).toContain("Remove gemma4:e4b from Ollama? It frees 9.6 GB.");
  expect(fake.raw.deleteModel).not.toHaveBeenCalled();
  await user.click(within(ask).getByRole("button", { name: "Remove" }));
  expect(fake.raw.deleteModel).toHaveBeenCalledWith(GEMMA);
  await waitFor(() => expect(fake.raw.listModels).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(dialog()).queryByRole("group", { name: "Confirm" })).toBeNull());
});

test("Remove is offered only for a downloaded Ollama model", async () => {
  const { user } = await openDialog();
  await pick(user, "Qwen3 235B");
  expect(within(dialog()).queryByRole("button", { name: "Remove" })).toBeNull();
  await pick(user, "Qwen3 14B");
  expect(within(dialog()).queryByRole("button", { name: "Remove" })).toBeNull();
});

test("a refused action shows its message in an alert and keeps the dialog", async () => {
  const { fake, user } = await openDialog();
  fake.raw.setSessionModel.mockRejectedValueOnce(rpcError(-32000, "model not found"));
  await pick(user, "Gemma 4 E4B");
  await user.click(within(dialog()).getByRole("button", { name: "Use for this session" }));
  const alert = await within(dialog()).findByRole("alert");
  expect(alert.textContent).toBe("model not found");
  expect(screen.getByRole("dialog", { name: "Choose a model" })).toBeTruthy();
  await user.click(optionOf("Qwen3 235B"));
  expect(within(dialog()).queryByRole("alert")).toBeNull();
});

test("a refused download takes the row back and says why", async () => {
  const { fake, page, user } = await openDialog();
  fake.raw.pullModel.mockRejectedValueOnce(rpcError(-32000, "Ollama is not running"));
  await pick(user, "Qwen3 14B");
  await user.click(within(dialog()).getByRole("button", { name: "Download" }));
  await user.click(within(dialog()).getByRole("button", { name: "Download" }));
  expect((await within(dialog()).findByRole("alert")).textContent).toBe("Ollama is not running");
  expect(page.pulls.getSnapshot().active.size).toBe(0);
  expect(within(dialog()).getByRole("group", { name: "Confirm" })).toBeTruthy();
});

test("while an action runs its button is busy and the others are off", async () => {
  const { fake, user } = await openDialog();
  let finish = () => {};
  fake.raw.setDefaultModel.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({} as never);
      }),
  );
  await user.click(within(dialog()).getByRole("button", { name: "Make default" }));
  const buttons = within(dialog()).getAllByRole("button");
  expect(within(dialog()).getByRole("button", { name: "Make default" }).getAttribute("aria-busy")).toBe("true");
  expect(buttons.filter((button) => !button.hasAttribute("disabled")).map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([]);
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Make default" }).hasAttribute("disabled")).toBe(false));
});

test("Refresh asks the providers again and shows the answer", async () => {
  const { fake, user } = await openDialog();
  fake.raw.listModels.mockResolvedValueOnce({ ...SAMPLE_LISTING, default: "local", models: SAMPLE_LISTING.models.slice(0, 3) });
  await user.click(within(dialog()).getByRole("button", { name: "Refresh the list" }));
  expect(fake.raw.listModels).toHaveBeenLastCalledWith(true);
  await waitFor(() => expect(options()).toHaveLength(3));
  expect(dialog().textContent).toContain("New sessions use local.");
});

test("it says Loading models… until the first answer", async () => {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
  let answer: (value: ModelListResult) => void = () => {};
  fake.raw.listModels.mockImplementation(
    () =>
      new Promise<ModelListResult>((resolve) => {
        answer = resolve;
      }),
  );
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  await wait();
  act(() => {
    fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_name: "m" }));
  });
  await userEvent.setup().click(chip());
  await screen.findByRole("dialog");
  expect(within(dialog()).getByText("Loading models…")).toBeTruthy();
  await act(async () => {
    answer(SAMPLE_LISTING);
  });
  expect(await screen.findAllByRole("option")).toHaveLength(9);
  expect(within(dialog()).queryByText("Loading models…")).toBeNull();
});

test("an empty listing says No models found.", async () => {
  await openDialog({ ...SAMPLE_LISTING, models: [], providers: [] });
  expect(within(dialog()).getByText("No models found.")).toBeTruthy();
});

test("a listing that fails shows the message and Retry asks again", async () => {
  const { fake, user } = await openDialog(new Error("daemon went away"));
  // The query retries once, a second later, before it gives up.
  const alert = await within(dialog()).findByRole("alert", {}, { timeout: 4000 });
  expect(alert.textContent).toContain("Could not list models: daemon went away");
  fake.raw.listModels.mockReset();
  fake.raw.listModels.mockResolvedValue(SAMPLE_LISTING);
  await user.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await screen.findAllByRole("option")).toHaveLength(9);
});

test("a model server changing state refetches the list while the dialog is open", async () => {
  const { fake } = await openDialog();
  expect(fake.raw.listModels).toHaveBeenCalledTimes(1);
  act(() => {
    fake.emitModelServer({ base_url: "http://localhost:11434", provider: "ollama", state: "stopped" });
  });
  await waitFor(() => expect(fake.raw.listModels).toHaveBeenCalledTimes(2));
});

test("a finished download refetches the list", async () => {
  const { fake } = await openDialog();
  act(() => {
    fake.emitPull({ kind: "done", done: { ref: MID, ok: true, error: null } });
  });
  await waitFor(() => expect(fake.raw.listModels).toHaveBeenCalledTimes(2));
});

test("closing with Esc puts focus back on the chip", async () => {
  const { user } = await openDialog();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(chip());
});

test("the list is not fetched until the dialog opens", async () => {
  const { fake } = await setup();
  expect(fake.raw.listModels).not.toHaveBeenCalled();
});

for (const theme of ["slip", "kiln"]) {
  test(`no accessibility violations on the list, a question, and a download in progress in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    const { fake, user } = await openDialog();
    expect((await axe.run(document.body, popup)).violations).toEqual([]);

    await pick(user, "Qwen3 14B");
    await user.click(within(dialog()).getByRole("button", { name: "Download" }));
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    await user.keyboard("{Escape}");

    await pick(user, "Gemma 4 E4B");
    await user.click(within(dialog()).getByRole("button", { name: "Remove" }));
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
    await user.keyboard("{Escape}");

    act(() => {
      fake.emitPull({ kind: "progress", progress: { ref: "ollama/gemma3:12b", status: "pulling", completed: 2_100_000_000, total: 6_600_000_000, progress: 0.32 } });
      fake.emitPull({ kind: "done", done: { ref: MID, ok: false, error: "no space left on device" } });
    });
    await pick(user, "Gemma 3 12B");
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  });

  test(`no accessibility violations on an empty search in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    const { user } = await openDialog();
    await user.type(search(), "zzz");
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  });

  test(`no accessibility violations on a failed listing in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    await openDialog(new Error("daemon went away"));
    await within(dialog()).findByRole("alert", {}, { timeout: 4000 });
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  }, 10_000);
}
