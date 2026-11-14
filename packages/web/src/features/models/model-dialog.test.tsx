import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { ModelListResult } from "../../store/models.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { rpcError, ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { sampleOptionsResult } from "./sample-tune.ts";
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
  // These listings are about the model dialog, not about what opens at the start.
  page.setupStart.decide();
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

const factsOf = (name: string) => Array.from(optionOf(name).querySelectorAll("span.items-end > span"), (fact) => fact.textContent);

test("a row shows its facts, one line per kind", async () => {
  await openDialog();
  expect(factsOf("local")).toEqual(["41k · free", "5.2 GB fits"]);
  expect(factsOf("Qwen3 14B")).toEqual(["41k · free", "9.3 GB fits", "download"]);
  expect(factsOf("Qwen3 235B")[0]).toContain("131k · $0.2/0.6");
});

test("the action bar is there before a model is picked, with its buttons disabled", async () => {
  const { user } = await openDialog();
  await user.type(screen.getByRole("combobox", { name: "Search models" }), "zzzz-no-such-model");
  const bar = screen.getByRole("group", { name: "Actions" });
  const buttons = within(bar).getAllByRole("button");
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect((button as HTMLButtonElement).disabled).toBe(true);
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

test("with Ollama missing, a download says to run golem tui, then /setup", async () => {
  const { user } = await openDialog(NO_OLLAMA_LISTING);
  expect(optionOf("Qwen3 8B").textContent).toContain("Ollama is not installed. Run golem tui, then /setup.");
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
  expect(fake.raw.listModels).toHaveBeenLastCalledWith(true, false);
  await waitFor(() => expect(options()).toHaveLength(3));
  expect(dialog().textContent).toContain("New sessions use local.");
});

const chips = () => within(dialog()).getByRole("group", { name: "Filter by category" });
const chipOf = (name: string) => within(chips()).getByRole("button", { name });

test("category chips filter the list, All brings it back, and the search narrows within a category", async () => {
  const { user } = await openDialog();
  const all = options().length;
  expect(chipOf("All").getAttribute("aria-pressed")).toBe("true");
  expect(within(chips()).getAllByRole("button").map((chip) => chip.textContent)).toEqual([
    "All",
    "General",
    "Coding",
    "Reasoning",
    "Vision",
    "Fast",
    "Long context",
  ]);
  await user.click(chipOf("Coding"));
  expect(chipOf("Coding").getAttribute("aria-pressed")).toBe("true");
  expect(chipOf("All").getAttribute("aria-pressed")).toBe("false");
  expect(options().map((option) => option.textContent)).toEqual([expect.stringContaining("Qwen3 14B")]);
  await user.click(chipOf("Vision"));
  expect(options()).toHaveLength(1);
  expect(optionOf("Gemma 4 E4B")).toBeDefined();
  await user.click(chipOf("General"));
  await user.type(search(), "gemma");
  expect(options().every((option) => option.textContent?.includes("Gemma"))).toBe(true);
  await user.clear(search());
  await user.click(chipOf("Fast"));
  expect(within(dialog()).getByText("No matching models.")).toBeDefined();
  await user.click(chipOf("All"));
  expect(options()).toHaveLength(all);
});

test("each model shows its categories beside it, without the general mark", async () => {
  await openDialog();
  expect(optionOf("Gemma 4 E4B").textContent).toContain("Vision");
  expect(optionOf("Gemma 4 E4B").textContent).toContain("Long context");
  expect(optionOf("Gemma 4 E4B").textContent).not.toContain("General");
  expect(optionOf("Qwen3 14B").textContent).toContain("Coding");
});

test("the dialog with a category chosen has no axe violations", async () => {
  const { user } = await openDialog();
  await user.click(chipOf("Vision"));
  expect((await axe.run(document.body, popup)).violations).toEqual([]);
});

test("Show all asks for every live model, and turning it off goes back to the short list", async () => {
  const { fake, user } = await openDialog();
  const extra = { ...SAMPLE_LISTING.models[0]!, ref: "openai/gpt-extra", label: "gpt-extra", provider: "openai", source: "remote" as const };
  fake.raw.listModels.mockImplementation((_refresh?: boolean, showAll?: boolean) =>
    Promise.resolve(showAll === true ? { ...SAMPLE_LISTING, models: [...SAMPLE_LISTING.models, extra] } : SAMPLE_LISTING),
  );
  const before = options().length;
  const box = within(dialog()).getByRole("checkbox", { name: "Show all models" });
  expect((box as HTMLInputElement).checked).toBe(false);
  await user.click(box);
  expect(fake.raw.listModels).toHaveBeenLastCalledWith(false, true);
  await waitFor(() => expect(options()).toHaveLength(before + 1));
  expect(optionOf("gpt-extra")).toBeDefined();
  await user.click(box);
  await waitFor(() => expect(options()).toHaveLength(before));
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

test("the dialog reads the listing the page already holds, and asks again only when it is refreshed", async () => {
  const { fake } = await setup();
  expect(fake.raw.listModels).toHaveBeenCalledTimes(1);
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

async function openTune(listing: ModelListResult = SAMPLE_LISTING, name = "local") {
  const opened = await openDialog(listing);
  opened.fake.raw.getModelOptions.mockImplementation(async (model) => sampleOptionsResult(model));
  await pick(opened.user, name);
  await opened.user.click(within(dialog()).getByRole("button", { name: "Tune" }));
  return opened;
}

const slider = (name: string) => within(dialog()).getByRole("slider", { name }) as HTMLInputElement;
const later = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
/** Makes the fake daemon keep what the model's options are set to, as a real one does. */
function keepSaved(fake: Awaited<ReturnType<typeof openTune>>["fake"]) {
  let kept: Record<string, number | string> = { temperature: 0.2 };
  fake.raw.setModelOptions.mockImplementation(async (model, options) => {
    kept = Object.fromEntries(Object.entries({ ...kept, ...options }).filter(([, value]) => value !== null)) as Record<string, number | string>;
    return { model, saved: kept };
  });
}

const tuneButton = () => within(dialog()).queryByRole("button", { name: "Tune" });
const heading = () => within(dialog()).getByRole("heading", { name: "Tune Qwen3 8B" });

test("the dialog has no tab strip, and only a ready local row has a Tune button", async () => {
  const { user } = await openDialog();
  expect(within(dialog()).queryByRole("tablist")).toBeNull();
  expect(within(dialog()).queryByRole("tab")).toBeNull();
  for (const [name, has] of [["local", true], ["Gemma 4 E4B", true], ["Qwen3 14B", false], ["sonnet", false], ["Qwen3 235B", false], ["Qwen2.5 7B", false]] as const) {
    await pick(user, name);
    expect(tuneButton() !== null).toBe(has);
  }
});

test("the Tune button opens that model's view, and Esc goes back to the button, and a second Esc closes", async () => {
  const { fake, user } = await openTune();
  expect(within(dialog()).queryByRole("combobox", { name: "Search models" })).toBeNull();
  expect(heading().textContent).toBe("Qwen3 8B");
  expect(dialog().textContent).toContain("qwen3:8b");
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(fake.raw.getModelOptions).toHaveBeenCalledWith("qwen3:8b", "a");
  expect(document.activeElement).toBe(heading());
  expect(within(dialog()).getByRole("button", { name: "Reset all options" })).toBeTruthy();
  expect(within(dialog()).getByRole("button", { name: "Done" })).toBeTruthy();
  expect(within(dialog()).queryByRole("button", { name: "Remove" })).toBeNull();
  await user.keyboard("{Escape}");
  expect(dialog()).toBeTruthy();
  expect(search()).toBeTruthy();
  expect(document.activeElement).toBe(tuneButton());
  expect(active()).toBe(optionOf("local"));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("left, Done, and the back button go back to the list", async () => {
  const { user } = await openDialog();
  await pick(user, "Gemma 4 E4B");
  await user.click(tuneButton() as HTMLElement);
  expect(within(dialog()).getByRole("heading", { name: "Tune Gemma 4 E4B" })).toBeTruthy();
  await user.keyboard("{ArrowLeft}");
  expect(search().value).toBe("");
  expect(document.activeElement).toBe(tuneButton());
  await user.click(tuneButton() as HTMLElement);
  await user.click(within(dialog()).getByRole("button", { name: "Done" }));
  expect(search()).toBeTruthy();
  await user.click(within(dialog()).getByRole("button", { name: "Tune" }));
  await user.click(within(dialog()).getByRole("button", { name: "Back to the models" }));
  expect(search()).toBeTruthy();
});

test("going back reads the listing again, for the row's fit", async () => {
  const { fake, user } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  const before = fake.raw.listModels.mock.calls.length;
  await user.keyboard("{Escape}");
  await waitFor(() => expect(fake.raw.listModels.mock.calls.length).toBeGreaterThan(before));
});

test("this session shows only for the session's model", async () => {
  const mine = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(within(dialog()).getByRole("button", { name: "This session only" })).toBeTruthy();
  expect(mine.fake.raw.getModelOptions).toHaveBeenCalledWith("qwen3:8b", "a");
  mine.unmount();
  const other = await openTune(SAMPLE_LISTING, "Gemma 4 E4B");
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(within(dialog()).queryByRole("button", { name: "This session only" })).toBeNull();
  expect(dialog().textContent).toContain("Saved for this model");
  expect(other.fake.raw.getModelOptions).toHaveBeenCalledWith("gemma4:e4b", undefined);
  fireEvent.change(slider("Top K"), { target: { value: "20" } });
  await waitFor(() => expect(other.fake.raw.setModelOptions).toHaveBeenCalledWith("gemma4:e4b", { top_k: 20 }), { timeout: 2000 });
  expect(other.fake.raw.setSessionOptions).not.toHaveBeenCalled();
});

test("Reset removes every value of the layer the changes go to", async () => {
  const { fake, user } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  await user.click(within(dialog()).getByRole("button", { name: "Reset all options" }));
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { temperature: null }), { timeout: 2000 });
  expect(slider("Temperature").value).toBe("0.6");
  expect((within(dialog()).getByRole("button", { name: "Reset all options" }) as HTMLButtonElement).disabled).toBe(true);
});

const PRESET_VALUES: [string, Record<string, number | null>][] = [
  ["Precise", { temperature: 0.2, top_p: 0.9, repeat_penalty: 1.1 }],
  ["Balanced", { temperature: null, top_p: null, top_k: null, min_p: null, repeat_penalty: null }],
  ["Creative", { temperature: 1.0, top_p: 0.95, min_p: 0.05 }],
  ["Long memory", { num_ctx: 14336 }],
];
for (const [name, values] of PRESET_VALUES) {
  test(`the ${name} preset sends session.set_options with its values`, async () => {
    const { fake, user } = await openTune();
    await within(dialog()).findByRole("slider", { name: "Temperature" });
    fake.raw.setSessionOptions.mockImplementation(async (_id, options) => ({
      session_id: "a",
      options: Object.fromEntries(Object.entries(options).filter(([, value]) => value !== null)) as Record<string, number>,
    }));
    await user.click(within(dialog()).getByRole("radio", { name }));
    await waitFor(() => expect(fake.raw.setSessionOptions).toHaveBeenCalledWith("a", values));
    expect(fake.raw.setModelOptions).not.toHaveBeenCalled();
  });
}

test("a preset lights only the rows it moved, and the highlight fades", async () => {
  const { fake, user } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  fake.raw.setSessionOptions.mockImplementation(async (_id, options) => ({ session_id: "a", options: options as Record<string, number> }));
  await user.click(within(dialog()).getByRole("radio", { name: "Creative" }));
  const lit = (name: string) => (slider(name).closest("li") as HTMLElement).className.includes("bg-clay/25");
  expect(lit("Temperature")).toBe(true);
  expect(lit("Top P")).toBe(true);
  expect(lit("Min P")).toBe(true);
  expect(lit("Top K")).toBe(false);
  expect(lit("Context size")).toBe(false);
  expect(slider("Temperature").value).toBe("1");
  expect(within(dialog()).getByRole("radio", { name: "Creative" }).getAttribute("aria-checked")).toBe("true");
  await waitFor(() => expect(lit("Temperature")).toBe(false), { timeout: 3000 });
});

test("Save these for the model shows while the session has overrides, and saves them", async () => {
  const { fake, user } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(within(dialog()).queryByRole("button", { name: "Save these for the model" })).toBeNull();
  fake.raw.setSessionOptions.mockImplementation(async (_id, options) => ({
    session_id: "a",
    options: Object.fromEntries(Object.entries(options).filter(([, value]) => value !== null)) as Record<string, number>,
  }));
  await user.click(within(dialog()).getByRole("radio", { name: "Creative" }));
  await user.click(await within(dialog()).findByRole("button", { name: "Save these for the model" }));
  await waitFor(() => expect(fake.raw.setSessionOptions).toHaveBeenCalledTimes(2));
  expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { temperature: 1, top_p: 0.95, min_p: 0.05 });
  expect(fake.raw.setSessionOptions).toHaveBeenLastCalledWith("a", { temperature: null, top_p: null, min_p: null });
});

test("a model that is not the session's has presets that wait for a session", async () => {
  await openTune(SAMPLE_LISTING, "Gemma 4 E4B");
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect((within(dialog()).getByRole("radio", { name: "Precise" }) as HTMLButtonElement).disabled).toBe(true);
});

const gauge = () => (slider("Context size").closest("li") as HTMLElement).textContent ?? "";

test("the gauge says fits, tight, or too big for the context size, with the cost against the default", async () => {
  await openTune();
  await within(dialog()).findByRole("slider", { name: "Context size" });
  expect(gauge()).toContain("+0.0 GB · fits");
  fireEvent.change(slider("Context size"), { target: { value: "32768" } });
  expect(gauge()).toContain("+3.5 GB · tight");
  fireEvent.change(slider("Context size"), { target: { value: "131072" } });
  expect(gauge()).toContain("+15.5 GB · too big");
  expect(document.body.textContent).not.toContain("This may not load on this Mac.");
  act(() => within(dialog()).getByRole("button", { name: "About Context size" }).focus());
  expect((await screen.findAllByText(/This may not load on this Mac\./)).length).toBeGreaterThan(0);
  fireEvent.change(slider("Context size"), { target: { value: "2048" } });
  expect(gauge()).toContain("−0.3 GB · fits");
});

test("there is no gauge when the daemon does not know the memory", async () => {
  const { fake, user } = await openDialog();
  fake.raw.getModelOptions.mockImplementation(async (model) => ({ ...sampleOptionsResult(model), memory: undefined }));
  await pick(user, "local");
  await user.click(within(dialog()).getByRole("button", { name: "Tune" }));
  await within(dialog()).findByRole("slider", { name: "Context size" });
  expect(gauge()).not.toContain(" GB");
});

test("the Tune view groups its options, one control each, with the long text in a tooltip", async () => {
  const { user } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(within(dialog()).getAllByRole("heading", { level: 3 }).map((item) => item.textContent)).toEqual(["Sampling", "Memory", "Output"]);
  expect(within(dialog()).getAllByRole("slider")).toHaveLength(6);
  expect(within(dialog()).getByRole("radiogroup", { name: "Keep loaded" })).toBeTruthy();
  expect(within(dialog()).getByRole("radiogroup", { name: "Answer length" })).toBeTruthy();
  expect(within(dialog()).getByRole("radiogroup", { name: "Seed" })).toBeTruthy();
  expect(within(dialog()).getByRole("radiogroup", { name: "Preset" })).toBeTruthy();
  const row = slider("Temperature").closest("li") as HTMLElement;
  expect(row.title).toBe("How adventurous each next word is.");
  expect(slider("Temperature").value).toBe("0.2");
  expect(row.textContent).toContain("How adventurous each next word is.");
  expect(row.textContent).toContain("model default 0.6");
  const keep = within(dialog()).getByRole("radiogroup", { name: "Keep loaded" });
  expect(within(keep).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["0", "30s", "5m", "30m", "always"]);
  expect(within(keep).getByRole("radio", { name: "5m" }).getAttribute("aria-checked")).toBe("true");
  // The long text is not on the page until the info icon is hovered.
  expect(document.body.textContent).not.toContain("A small number keeps the answer safe and plain.");
  await user.hover(within(dialog()).getByRole("button", { name: "About Top K" }));
  expect((await screen.findAllByText(/A small number keeps the answer safe and plain\./)).length).toBeGreaterThan(0);
});

test("a reset icon shows only for a row with a value in the layer, and the heading has no focus ring", async () => {
  const { fake, user } = await openTune();
  keepSaved(fake);
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(within(dialog()).getByRole("button", { name: "Reset Temperature" })).toBeTruthy();
  expect(within(dialog()).queryByRole("button", { name: "Reset Top K" })).toBeNull();
  expect(within(dialog()).queryByRole("button", { name: "Reset Keep loaded" })).toBeNull();
  expect(heading().className).toContain("outline-none");
  await user.click(within(dialog()).getByRole("radio", { name: "30m" }));
  expect(await within(dialog()).findByRole("button", { name: "Reset Keep loaded" })).toBeTruthy();
});

test("Answer length and Seed are a mode plus a number, and the number goes through the same save", async () => {
  const { fake, user } = await openTune();
  keepSaved(fake);
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  const length = within(dialog()).getByRole("radiogroup", { name: "Answer length" });
  const limit = within(dialog()).getByRole("spinbutton", { name: "Answer length limit" }) as HTMLInputElement;
  expect(within(length).getByRole("radio", { name: "Until done" }).getAttribute("aria-checked")).toBe("true");
  expect(limit.disabled).toBe(true);
  await user.click(within(length).getByRole("radio", { name: "Fill context" }));
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { num_predict: -2 }), { timeout: 2000 });
  await user.click(within(length).getByRole("radio", { name: "Limit" }));
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { num_predict: 4096 }), { timeout: 2000 });
  expect(limit.disabled).toBe(false);
  fireEvent.change(limit, { target: { value: "512" } });
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { num_predict: 512 }), { timeout: 2000 });
  const seed = within(dialog()).getByRole("radiogroup", { name: "Seed" });
  const value = within(dialog()).getByRole("spinbutton", { name: "Seed value" }) as HTMLInputElement;
  expect(within(seed).getByRole("radio", { name: "Random" }).getAttribute("aria-checked")).toBe("true");
  expect(value.disabled).toBe(true);
  await user.click(within(seed).getByRole("radio", { name: "Fixed" }));
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { seed: 42 }), { timeout: 2000 });
  fireEvent.change(value, { target: { value: "7" } });
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { seed: 7 }), { timeout: 2000 });
  await user.click(within(seed).getByRole("radio", { name: "Random" }));
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { seed: null }), { timeout: 2000 });
});

test("the footer says Saved once the writes are done", async () => {
  const { user } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(within(dialog()).getAllByRole("status").some((item) => item.textContent === "Saved ✓")).toBe(false);
  await user.click(within(dialog()).getByRole("radio", { name: "30m" }));
  await waitFor(() => expect(within(dialog()).getAllByRole("status").some((item) => item.textContent === "Saved ✓")).toBe(true), { timeout: 2000 });
});

test("moving a slider sends model.options.set once after the debounce", async () => {
  const { fake } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  fireEvent.change(slider("Temperature"), { target: { value: "0.5" } });
  fireEvent.change(slider("Temperature"), { target: { value: "0.7" } });
  expect(slider("Temperature").value).toBe("0.7");
  expect(fake.raw.setModelOptions).not.toHaveBeenCalled();
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledTimes(1), { timeout: 2000 });
  await later(400);
  expect(fake.raw.setModelOptions).toHaveBeenCalledTimes(1);
  expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { temperature: 0.7 });
  expect(fake.raw.setSessionOptions).not.toHaveBeenCalled();
});

test("with This session only, a change sends session.set_options", async () => {
  const { fake, user } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  await user.click(within(dialog()).getByRole("button", { name: "This session only" }));
  fireEvent.change(slider("Top K"), { target: { value: "20" } });
  await waitFor(() => expect(fake.raw.setSessionOptions).toHaveBeenCalledTimes(1), { timeout: 2000 });
  expect(fake.raw.setSessionOptions).toHaveBeenCalledWith("a", { top_k: 20 });
  expect(fake.raw.setModelOptions).not.toHaveBeenCalled();
});

test("reset sends null for the row", async () => {
  const { fake, user } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(within(dialog()).queryByRole("button", { name: "Reset Top K" })).toBeNull();
  await user.click(within(dialog()).getByRole("button", { name: "Reset Temperature" }));
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { temperature: null }), { timeout: 2000 });
  expect(slider("Temperature").value).toBe("0.6");
});

test("the keep_alive radios send their value", async () => {
  const { fake, user } = await openTune();
  const group = await within(dialog()).findByRole("radiogroup", { name: "Keep loaded" });
  await user.click(within(group).getByRole("radio", { name: "always" }));
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { keep_alive: -1 }), { timeout: 2000 });
});

test("the arrow keys move inside a radio group and do not leave the view", async () => {
  const { fake } = await openTune();
  keepSaved(fake);
  const group = await within(dialog()).findByRole("radiogroup", { name: "Keep loaded" });
  within(group).getByRole("radio", { name: "5m" }).focus();
  const user = userEvent.setup();
  await user.keyboard("{ArrowLeft}");
  expect(within(dialog()).getByRole("radiogroup", { name: "Keep loaded" })).toBeTruthy();
  expect(within(group).getByRole("radio", { name: "30s" }).getAttribute("aria-checked")).toBe("true");
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { keep_alive: "30s" }), { timeout: 2000 });
});

test("a change saved by another client shows at once, and so does a session override", async () => {
  const { fake } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  act(() => fake.emitOptionsSaved({ model: "qwen3:8b", saved: { temperature: 0.9 } }));
  expect(slider("Temperature").value).toBe("0.9");
  act(() => fake.emitOptionsSaved({ model: "other", saved: { temperature: 1.5 } }));
  expect(slider("Temperature").value).toBe("0.9");
  act(() => fake.emitEvent(ev("a", "model.options.changed", { options: { top_k: 12 } })));
  await waitFor(() => expect(slider("Top K").value).toBe("12"));
});

test("a hosted row has no Tune button", async () => {
  const { user, fake } = await openDialog();
  act(() => fake.emitEvent(ev("a", "model.selected", { model_profile: "sonnet", model_provider: "anthropic", model_name: "claude-sonnet-4" })));
  await pick(user, "sonnet");
  expect(tuneButton()).toBeNull();
});

for (const theme of ["slip", "kiln"]) {
  test(`no accessibility violations on the model list with Tune buttons in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    await openDialog();
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  });

  for (const [label, value] of [["fits", "4096"], ["tight", "32768"], ["too big", "131072"]] as const) {
    test(`no accessibility violations on the Tune view in ${theme}, with the gauge saying ${label}`, async () => {
      document.documentElement.dataset.theme = theme;
      await openTune();
      await within(dialog()).findByRole("slider", { name: "Temperature" });
      fireEvent.change(slider("Context size"), { target: { value } });
      expect(gauge()).toContain(label);
      expect((await axe.run(document.body, popup)).violations).toEqual([]);
    });
  }
}

const tryButton = () => within(dialog()).queryByRole("button", { name: "Try again with these settings" }) as HTMLButtonElement | null;

function talk(fake: Awaited<ReturnType<typeof openTune>>["fake"], turns: [string, string][]) {
  act(() => {
    turns.forEach(([question, answer], index) => {
      fake.emitEvent(ev("a", "message.completed", { message_id: `q${index}`, role: "user", text: question }));
      fake.emitEvent(ev("a", "message.completed", { message_id: `a${index}`, role: "assistant", text: answer }));
    });
  });
}

test("Try again forks before the question, renames, sets the options, and sends on the fork only", async () => {
  const { fake, user } = await openTune();
  talk(fake, [["hello", "hi there"], ["what is a mutex?", "A lock.\nIt keeps two threads apart."]]);
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  await waitFor(() => expect(tryButton()?.disabled).toBe(false));
  await user.click(tryButton() as HTMLElement);
  await waitFor(() => expect(fake.raw.sendMessage).toHaveBeenCalledWith("s_fork", "what is a mutex?"));
  expect(fake.raw.forkSession).toHaveBeenCalledWith("a", "a0");
  expect(fake.raw.renameSession).toHaveBeenCalledWith("s_fork", "try · UTF-8 split");
  expect(fake.raw.setSessionOptions).toHaveBeenCalledWith("s_fork", { temperature: 0.2 });
  expect(fake.raw.sendMessage.mock.calls.every(([id]) => id !== "a")).toBe(true);
  expect(fake.raw.createSession).not.toHaveBeenCalled();
  expect(dialog().textContent).toContain("try · temperature 0.2");
  expect(dialog().textContent).toContain("was: A lock.");
});

test("the answer streams under the rows and the link opens the fork", async () => {
  const { fake, user } = await openTune();
  talk(fake, [["hello", "hi there"], ["what is a mutex?", "A lock."]]);
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  await waitFor(() => expect(tryButton()?.disabled).toBe(false));
  await user.click(tryButton() as HTMLElement);
  await waitFor(() => expect(fake.raw.sendMessage).toHaveBeenCalledWith("s_fork", "what is a mutex?"));
  // The fork's history replays first. It is not the new answer.
  act(() => {
    fake.emitEvent(ev("s_fork", "message.completed", { message_id: "q0", role: "user", text: "hello" }));
    fake.emitEvent(ev("s_fork", "message.completed", { message_id: "a0", role: "assistant", text: "hi there" }));
  });
  expect(within(dialog()).queryByText("hi there")).toBeNull();
  act(() => {
    fake.emitEvent(ev("s_fork", "run.started", {}));
    fake.emitEvent(ev("s_fork", "message.completed", { message_id: "q1", role: "user", text: "what is a mutex?" }));
    fake.emitEvent(ev("s_fork", "message.completed", { message_id: "a1", role: "assistant", text: "Two threads, one lock." }));
    fake.emitEvent(ev("s_fork", "run.completed", {}));
  });
  expect(await within(dialog()).findByText("Two threads, one lock.")).toBeTruthy();
  // The chat itself is unchanged.
  await user.click(within(dialog()).getByRole("link", { name: "Open the try session" }));
  expect(location.pathname).toBe("/s/s_fork");
  expect(screen.queryByRole("dialog", { name: "Choose a model" })).toBeNull();
});

test("a question that is the first message starts a new session in the same folder", async () => {
  const { fake, user } = await openTune();
  talk(fake, [["what is a mutex?", "A lock."]]);
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  await waitFor(() => expect(tryButton()?.disabled).toBe(false));
  await user.click(tryButton() as HTMLElement);
  await waitFor(() => expect(fake.raw.sendMessage).toHaveBeenCalledWith("s_new", "what is a mutex?"));
  expect(fake.raw.createSession).toHaveBeenCalledWith({ cwd: CWD, modelProfile: "local" });
  expect(fake.raw.forkSession).not.toHaveBeenCalled();
});

test("Try again is disabled with no question and while the chat runs", async () => {
  const { fake } = await openTune();
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(tryButton()?.disabled).toBe(true);
  expect(dialog().textContent).toContain("Ask something first, then try again.");
  talk(fake, [["hello", "hi there"]]);
  await waitFor(() => expect(tryButton()?.disabled).toBe(false));
  act(() => fake.emitEvent(ev("a", "run.started", {})));
  await waitFor(() => expect(tryButton()?.disabled).toBe(true));
  expect(dialog().textContent).toContain("Wait for the answer, then try again.");
  expect(fake.raw.forkSession).not.toHaveBeenCalled();
});

test("Try again is absent when the tuned model is not the session's", async () => {
  const { fake } = await openTune(SAMPLE_LISTING, "Gemma 4 E4B");
  talk(fake, [["hello", "hi there"]]);
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  expect(tryButton()).toBeNull();
});

test("Try again works with a num_ctx that has no default", async () => {
  const { fake, user } = await openTune();
  fake.raw.getModelOptions.mockImplementation(async (model) => {
    const result = sampleOptionsResult(model);
    const defaults = Object.fromEntries(Object.entries(result.defaults).filter(([name]) => name !== "num_ctx"));
    return { ...result, defaults, options: result.options.map((item) => (item.name === "num_ctx" ? { ...item, default: null } : item)) };
  });
  talk(fake, [["hello", "hi there"], ["what is a mutex?", "A lock."]]);
  await user.click(within(dialog()).getByRole("button", { name: "Back to the models" }));
  await user.click(within(dialog()).getByRole("button", { name: "Tune" }));
  await within(dialog()).findByRole("slider", { name: "Temperature" });
  await waitFor(() => expect(tryButton()?.disabled).toBe(false));
  await user.click(tryButton() as HTMLElement);
  await waitFor(() => expect(fake.raw.sendMessage).toHaveBeenCalledWith("s_fork", "what is a mutex?"));
  expect(fake.raw.setSessionOptions).toHaveBeenCalledWith("s_fork", { temperature: 0.2 });
});

for (const theme of ["slip", "kiln"]) {
  test(`no accessibility violations on the Tune view with a try in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    const { fake, user } = await openTune();
    talk(fake, [["hello", "hi there"], ["what is a mutex?", "A lock."]]);
    await within(dialog()).findByRole("slider", { name: "Temperature" });
    await waitFor(() => expect(tryButton()?.disabled).toBe(false));
    await user.click(tryButton() as HTMLElement);
    await within(dialog()).findByRole("link", { name: "Open the try session" });
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  });
}

test("a thinking model has a think radio group that sends its value, and another model has none", async () => {
  const { fake, user } = await openTune();
  expect(within(dialog()).queryByRole("radiogroup", { name: "Think" })).toBeNull();
  fake.raw.getModelOptions.mockImplementation(async (model) => ({ ...sampleOptionsResult("qwen3.5:4b"), model }));
  await user.click(within(dialog()).getByRole("button", { name: "Back to the models" }));
  await user.click(within(dialog()).getByRole("button", { name: "Tune" }));
  const group = await within(dialog()).findByRole("radiogroup", { name: "Think" });
  expect(within(group).getAllByRole("radio").map((item) => item.textContent)).toEqual(["Model default", "off", "on"]);
  expect(within(group).getByRole("radio", { name: "Model default" }).getAttribute("aria-checked")).toBe("true");
  await user.click(within(group).getByRole("radio", { name: "off" }));
  await waitFor(() => expect(fake.raw.setModelOptions).toHaveBeenCalledWith("qwen3:8b", { think: "off" }), { timeout: 2000 });
});

test("a model with thinking levels offers low, medium, and high", async () => {
  const { fake, user } = await openTune();
  fake.raw.getModelOptions.mockImplementation(async (model) => ({ ...sampleOptionsResult("gpt-oss:20b"), model }));
  await user.click(within(dialog()).getByRole("button", { name: "Back to the models" }));
  await user.click(within(dialog()).getByRole("button", { name: "Tune" }));
  const group = await within(dialog()).findByRole("radiogroup", { name: "Think" });
  expect(within(group).getAllByRole("radio").map((item) => item.textContent)).toEqual(["Model default", "low", "medium", "high"]);
});

for (const theme of ["slip", "kiln"]) {
  test(`no accessibility violations on the Tune view of a thinking model in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    const { fake, user } = await openTune();
    fake.raw.getModelOptions.mockImplementation(async (model) => ({ ...sampleOptionsResult("qwen3.5:4b"), model, saved: { think: "off" } }));
    await user.click(within(dialog()).getByRole("button", { name: "Back to the models" }));
    await user.click(within(dialog()).getByRole("button", { name: "Tune" }));
    await within(dialog()).findByRole("radiogroup", { name: "Think" });
    expect((await axe.run(document.body, popup)).violations).toEqual([]);
  });
}
