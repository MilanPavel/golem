import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { MEMORY_OFF_TEXT, MEMORY_OLD_TEXT, type MemoryCounts, type MemoryItem, type MemorySettings } from "../../store/memory.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, INVALID_PARAMS_CODE, rpcError, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { SAMPLE_MEMORIES } from "./memory/sample.ts";
import { settingsContextStore } from "./index.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const COUNTS: MemoryCounts = { you: 3, project: 1, history: 1, proposed: 1, kept: 3, stale: 1 };
const SETTINGS: MemorySettings = { you: "chat", projects: "chat", history: "chat" };

type Params = { scope?: string | null; query?: string | null; after?: string | null; limit?: number };

/** A daemon that answers `memory.list` from `items`, by scope, with a search by words in the text. */
function mount(items: MemoryItem[] = SAMPLE_MEMORIES, extra: { counts?: MemoryCounts; settings?: MemorySettings } = {}) {
  history.replaceState(null, "", "/settings/memory");
  const fake = fakeClient();
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.listMemories.mockImplementation(async (params?: Params) => {
    const word = params?.query?.toLowerCase() ?? "";
    const hits = items.filter((item) => item.scope === params?.scope && item.text.toLowerCase().includes(word));
    const start = params?.after == null ? 0 : hits.findIndex((item) => item.id === params.after) + 1;
    const page = hits.slice(start, start + (params?.limit ?? 100));
    return { items: page, total: hits.length, counts: extra.counts ?? COUNTS, settings: extra.settings ?? SETTINGS };
  });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  act(() => {
    fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"));
  });
  settingsContextStore.set({ sessionId: "a", cwd: "/Users/you/repos/golem" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, user: userEvent.setup(), ...view };
}

const rowOf = (title: string) => screen.getByRole("listitem", { name: title });

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
  vi.unstubAllGlobals();
});

test("the tabs are You, This project and History with their counts, and each shows its own rows", async () => {
  const { user } = mount();
  expect(await screen.findByRole("tab", { name: "You 3" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "This project 1" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "History 1" })).toBeTruthy();
  const pnpm = await screen.findByRole("listitem", { name: "I prefer pnpm" });
  expect(pnpm.textContent).toContain("you said");
  expect(pnpm.textContent).toContain("in every chat");
  const proposal = rowOf("Keep replies short");
  expect(proposal.textContent).toContain("golem proposed");
  expect(proposal.textContent).toContain("waiting for you");
  await user.click(screen.getByRole("tab", { name: "This project 1" }));
  const note = await screen.findByRole("listitem", { name: "Where the retry policy is set" });
  expect(note.textContent).toContain("an explorer · 1 file · you kept");
  expect(note.textContent).toContain("may be out of date");
  expect(within(note).getByRole("list", { name: "Sources" }).textContent).toContain("app/client.py");
  await user.click(screen.getByRole("tab", { name: "History 1" }));
  const summaryRow = await screen.findByRole("listitem", { name: "Fixing the flaky sidebar test" });
  expect(summaryRow.textContent).toContain("golem proposed · kept automatically");
});

test("the section is in the list of Settings, and /settings/memory shows it", async () => {
  mount();
  expect(await screen.findByRole("heading", { level: 2, name: "Memory" })).toBeTruthy();
  expect(within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("link", { name: "Memory" }).getAttribute("aria-current")).toBe("page");
});

test("typing in the search box asks memory.list for that word", async () => {
  const { fake, user } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  await user.type(screen.getByRole("searchbox", { name: "Search memory" }), "pnpm");
  await waitFor(() => expect(fake.raw.listMemories).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "you", query: "pnpm" })));
  await waitFor(() => expect(screen.queryByRole("listitem", { name: "Keep replies short" })).toBeNull());
  expect(screen.getByRole("listitem", { name: "I prefer pnpm" })).toBeTruthy();
  await user.clear(screen.getByRole("searchbox", { name: "Search memory" }));
  await user.type(screen.getByRole("searchbox", { name: "Search memory" }), "zzz");
  expect(await screen.findByText("No memory matches.")).toBeTruthy();
});

test("a long list is read a page at a time with Show more, so every row can be reached", async () => {
  const many: MemoryItem[] = Array.from({ length: 130 }, (_, index) => ({
    ...SAMPLE_MEMORIES[0]!,
    id: `m_${String(index).padStart(3, "0")}`,
    title: `Note ${index}`,
    text: `Note ${index}`,
    always: false,
  }));
  const { fake, user } = mount(many, { counts: { you: 130, project: 0, history: 0 } });
  expect(await screen.findByText("100 of 130 shown")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show more" }));
  expect(await screen.findByText("130 shown")).toBeTruthy();
  expect(fake.raw.listMemories).toHaveBeenLastCalledWith(expect.objectContaining({ after: "m_099" }));
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
});

test("Edit changes the text through memory.update, and Cancel leaves it alone", async () => {
  const { fake, user } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  await user.click(screen.getByRole("button", { name: "Edit I prefer pnpm" }));
  const box = screen.getByRole("textbox", { name: "Text of I prefer pnpm" }) as HTMLTextAreaElement;
  await user.clear(box);
  await user.type(box, "I prefer bun.");
  await user.click(within(rowOf("I prefer pnpm")).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fake.raw.updateMemory).toHaveBeenCalledWith({ id: "m_1", text: "I prefer bun." }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Text of I prefer pnpm" })).toBeNull());
  await user.click(screen.getByRole("button", { name: "Edit Keep replies short" }));
  await user.type(screen.getByRole("textbox", { name: "Text of Keep replies short" }), " more");
  await user.click(within(rowOf("Keep replies short")).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.updateMemory).toHaveBeenCalledTimes(1);
  expect(rowOf("Keep replies short").textContent).toContain("No summary at the end.");
});

test("a refused edit says why and keeps the editor open", async () => {
  const { fake, user } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  fake.raw.updateMemory.mockRejectedValue(rpcError(INVALID_PARAMS_CODE, "a memory is at most 2000 characters; write a skill instead"));
  await user.click(screen.getByRole("button", { name: "Edit I prefer pnpm" }));
  await user.type(screen.getByRole("textbox", { name: "Text of I prefer pnpm" }), " x");
  await user.click(within(rowOf("I prefer pnpm")).getByRole("button", { name: "Save" }));
  expect((await within(rowOf("I prefer pnpm")).findByRole("alert")).textContent).toContain("at most 2000 characters");
  expect(screen.getByRole("textbox", { name: "Text of I prefer pnpm" })).toBeTruthy();
});

test("Delete asks first, then calls memory.delete and drops the row when the list is read again", async () => {
  const { fake, user } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  await user.click(screen.getByRole("button", { name: "Delete I prefer pnpm" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete this memory?" });
  expect(fake.raw.deleteMemories).not.toHaveBeenCalled();
  fake.raw.listMemories.mockImplementation(async () => ({ items: SAMPLE_MEMORIES.slice(1, 3), total: 2, counts: { ...COUNTS, you: 2 }, settings: SETTINGS }));
  await user.click(within(dialog).getByRole("button", { name: "Delete memory" }));
  await waitFor(() => expect(fake.raw.deleteMemories).toHaveBeenCalledWith(["m_1"]));
  await waitFor(() => expect(screen.queryByRole("listitem", { name: "I prefer pnpm" })).toBeNull());
  expect(screen.getByRole("tab", { name: "You 2" })).toBeTruthy();
});

test("Cancel in the delete dialog deletes nothing", async () => {
  const { fake, user } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  await user.click(screen.getByRole("button", { name: "Delete I prefer pnpm" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(fake.raw.deleteMemories).not.toHaveBeenCalled();
});

test("Export Markdown and Export JSON ask memory.export for the tab's scope and save the text as a file", async () => {
  const { fake, user } = mount();
  const created: Blob[] = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: Blob) => (created.push(blob), "blob:memory"), revokeObjectURL: () => {} }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fake.raw.exportMemories.mockResolvedValue({ format: "markdown", text: "# I prefer pnpm", count: 1 });
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  await user.click(screen.getByRole("button", { name: "Export Markdown" }));
  await waitFor(() => expect(fake.raw.exportMemories).toHaveBeenCalledWith({ scope: "you", format: "markdown" }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(await created[0]?.text()).toBe("# I prefer pnpm");
  fake.raw.exportMemories.mockResolvedValue({ format: "json", text: "[]", count: 0 });
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  await waitFor(() => expect(fake.raw.exportMemories).toHaveBeenLastCalledWith({ scope: "you", format: "json" }));
  click.mockRestore();
});

test("the scope's privacy switch reads [memory] and sets it through memory.settings", async () => {
  const { fake, user } = mount(SAMPLE_MEMORIES, { settings: { you: "chat", projects: "local", history: "chat" } });
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  const you = screen.getByRole("switch", { name: "May be sent to a paid model" });
  expect(you.getAttribute("aria-checked")).toBe("true");
  await user.click(you);
  await waitFor(() => expect(fake.raw.memorySettings).toHaveBeenCalledWith({ scope: "you", privacy: "local" }));
  await user.click(screen.getByRole("tab", { name: "This project 1" }));
  await screen.findByRole("listitem", { name: "Where the retry policy is set" });
  const project = screen.getByRole("switch", { name: "May be sent to a paid model" });
  expect(project.getAttribute("aria-checked")).toBe("false");
  await user.click(project);
  await waitFor(() => expect(fake.raw.memorySettings).toHaveBeenLastCalledWith({ scope: "project", privacy: "chat" }));
});

test("a refused scope switch says why", async () => {
  const { fake, user } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  fake.raw.memorySettings.mockRejectedValue(rpcError(INVALID_PARAMS_CODE, "config.toml changed on disk"));
  await user.click(screen.getByRole("switch", { name: "May be sent to a paid model" }));
  expect((await screen.findByRole("alert")).textContent).toBe("config.toml changed on disk");
});

test("a row's privacy switch and its in-every-chat switch call memory.update", async () => {
  const { fake, user } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  const privacy = screen.getByRole("switch", { name: "I prefer pnpm: may be sent to a paid model" });
  expect(privacy.getAttribute("aria-checked")).toBe("true");
  await user.click(privacy);
  await waitFor(() => expect(fake.raw.updateMemory).toHaveBeenCalledWith({ id: "m_1", privacy: "local" }));
  // A `local` row is off.
  expect(screen.getByRole("switch", { name: "My work address: may be sent to a paid model" }).getAttribute("aria-checked")).toBe("false");
  await user.click(screen.getByRole("switch", { name: "My work address: may be sent to a paid model" }));
  await waitFor(() => expect(fake.raw.updateMemory).toHaveBeenLastCalledWith({ id: "m_3", privacy: "chat" }));
  const always = screen.getByRole("switch", { name: "I prefer pnpm: in every chat" });
  expect(always.getAttribute("aria-checked")).toBe("true");
  await user.click(always);
  await waitFor(() => expect(fake.raw.updateMemory).toHaveBeenLastCalledWith({ id: "m_1", always: false }));
});

test("a History row has no in-every-chat switch", async () => {
  const { user } = mount();
  await user.click(await screen.findByRole("tab", { name: "History 1" }));
  await screen.findByRole("listitem", { name: "Fixing the flaky sidebar test" });
  expect(screen.queryByRole("switch", { name: /in every chat/ })).toBeNull();
});

test("nothing remembered says how to start", async () => {
  mount([], { counts: { you: 0, project: 0, history: 0 } });
  expect(await screen.findByText('Nothing remembered yet. Say "remember that …" in a chat.')).toBeTruthy();
  expect((screen.getByRole("button", { name: "Export Markdown" }) as HTMLButtonElement).disabled).toBe(true);
});

test("with [memory] enabled = false the daemon says memory is off, and the page says how to turn it on", async () => {
  const { fake } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  fake.raw.listMemories.mockRejectedValue(rpcError(INVALID_PARAMS_CODE, "memory is off: [memory] enabled = false"));
  // Memory is turned off while the page is open: a changed notice reads the list again.
  act(() => {
    fake.emitMemory({ id: "m_1", change: "updated", scope: "you" });
  });
  expect((await screen.findByRole("status")).textContent).toBe(MEMORY_OFF_TEXT);
  expect(screen.queryByRole("tab")).toBeNull();
});

test("memory off from the first read shows the same notice", async () => {
  history.replaceState(null, "", "/settings/memory");
  const fake = fakeClient();
  fake.raw.listMemories.mockRejectedValue(rpcError(INVALID_PARAMS_CODE, "memory is off: [memory] enabled = false"));
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  expect((await screen.findByRole("status")).textContent).toBe(MEMORY_OFF_TEXT);
});

test("a daemon that has no memory methods says golem needs an update", async () => {
  history.replaceState(null, "", "/settings/memory");
  const fake = fakeClient();
  fake.raw.listMemories.mockRejectedValue(rpcError(-32601, "method not found: memory.list"));
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(MEMORY_OLD_TEXT);
});

// ADR-061, "both ways": a local memory is usable with a local model, and says it is unused without one. The screen needs neither.
const LOCAL_ROW: MemoryItem = { ...SAMPLE_MEMORIES[2]!, usable: true };

test("local models only: a local row is usable, so it says only that it is local", async () => {
  mount([LOCAL_ROW]);
  const row = await screen.findByRole("listitem", { name: "My work address" });
  expect(row.textContent).toContain("local models only");
  expect(row.textContent).not.toContain("not used");
});

test("cloud models only: a local row says it is not used, because no local model is set up", async () => {
  mount([{ ...LOCAL_ROW, usable: false }]);
  const row = await screen.findByRole("listitem", { name: "My work address" });
  expect(row.textContent).toContain("local models only");
  expect(row.textContent).toContain("not used: no local model is set up");
});

test("a chat-level row is never marked unused, whatever models there are", async () => {
  mount([{ ...SAMPLE_MEMORIES[0]!, usable: null }]);
  const row = await screen.findByRole("listitem", { name: "I prefer pnpm" });
  expect(row.textContent).not.toContain("not used");
});

test("memory.changed reads the list again", async () => {
  const { fake } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  const calls = fake.raw.listMemories.mock.calls.length;
  fake.raw.listMemories.mockImplementation(async () => ({ items: [SAMPLE_MEMORIES[1]!], total: 1, counts: { ...COUNTS, you: 1 }, settings: SETTINGS }));
  act(() => {
    fake.emitMemory({ id: "m_1", change: "deleted", scope: "you" });
  });
  await waitFor(() => expect(screen.queryByRole("listitem", { name: "I prefer pnpm" })).toBeNull());
  expect(fake.raw.listMemories.mock.calls.length).toBeGreaterThan(calls);
  expect(screen.getByRole("tab", { name: "You 1" })).toBeTruthy();
});

test("the page has no accessibility violations", async () => {
  const { container } = mount();
  await screen.findByRole("listitem", { name: "I prefer pnpm" });
  const result = await axe.run(container, noContrast);
  expect(result.violations.map((violation) => violation.id)).toEqual([]);
});
