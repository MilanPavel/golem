import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { contextActions, type ContextActionsInput } from "@golem/view";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { inspectPath } from "../../store/router.ts";
import type { ListedModel } from "../../store/models.ts";
import { ev, fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { ContextBannerView } from "./context-banner.tsx";
import { ContextChipView } from "./context-chip.tsx";

const CWD = "/Users/you/repos/golem";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

const MODELS: ListedModel[] = [
  { ref: "ollama/qwen3:27b", label: "qwen3:27b", provider: "ollama", source: "installed", status: "ready", tier: "local", ctx: 131072, price: { input: 0, output: 0 } },
  { ref: "deepseek/deepseek-chat", label: "deepseek-chat", provider: "deepseek", source: "remote", status: "ready", tier: "budget", ctx: 128000, tools: true, price: { input: 0.28, output: 1.1 } },
];
const MEMORY = { ram_gb: 32, size_gb: 16, kv_gb_per_1k_tokens: 0.06, overhead_gb: 1, fits_share: 0.5, tight_share: 0.75 };

/** Six turns with a 3K tool result each. */
const MESSAGES = Array.from({ length: 6 }, () => [
  { role: "user", text: "read it", tokens: 100 },
  { role: "assistant", text: "reading", tokens: 100 },
  { role: "tool", text: "file", tokens: 3000 },
]).flat();

async function setup(options: { provider?: string; name?: string; cut?: "yes" | "no"; used?: number; planned?: boolean } = {}) {
  history.replaceState(null, "", "/s/a");
  const { provider = "ollama", name = "qwen3:27b", cut = "no", used = 27000, planned = true } = options;
  const fake = fakeClient();
  fake.raw.listModels.mockResolvedValue({
    default: "ollama/qwen3:27b",
    models: MODELS,
    providers: [],
    setup: { ollama_installed: true, ollama_running: true, keys: [], default_status: "ready" },
  } as never);
  fake.raw.getModelOptions.mockImplementation(async (model) => ({ model, options: [], defaults: {}, saved: {}, session: {}, memory: MEMORY }) as never);
  fake.raw.getTraceSpan.mockImplementation(
    async (_id, spanId) =>
      ({
        span: { id: spanId, kind: "model", name: "m", start: "t", status: "ok" },
        messages: MESSAGES,
        context: { used, window: 32768, parts: [], estimated: true, window_planned: planned, reserve: 4096, prompt_cut: cut, cleared: { count: 0, tokens: 0 } },
      }) as never,
  );
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  act(() => {
    fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_provider: provider, model_name: name, title: "UTF-8 split" }));
  });
  await wait();
  act(() => fake.emitEvent(ev("a", "model.call.started", { message_id: "m1", model: name, context_window: 32768, window_planned: planned, ...(planned ? { num_ctx: 32768 } : {}) })));
  act(() => fake.emitEvent(ev("a", "model.call.completed", { message_id: "m1", usage: { input: used, output: 100 } })));
  await wait();
  return fake;
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

const chip = () => screen.getByRole("button", { name: /^Context / });
const rowOf = (popover: HTMLElement, name: RegExp) => within(popover).getByRole("button", { name });

test("the chip opens a popover with the bar, the window's source, and the rows with their costs", async () => {
  await setup();
  const user = userEvent.setup();
  await waitFor(() => expect(chip().textContent).toContain("82%"));
  await user.click(chip());
  const popover = await screen.findByRole("dialog", { name: "Context" });
  expect(within(popover).getByText("27.0K of 32K · reply reserve 4K")).toBeTruthy();
  expect(within(popover).getByText("32K · planned by golem for this Mac")).toBeTruthy();
  expect(within(popover).getByRole("meter").getAttribute("aria-valuenow")).toBe("82");
  await waitFor(() => expect(rowOf(popover, /^Clear old tool results/).hasAttribute("disabled")).toBe(false));
  const rows = within(popover).getAllByRole("listitem").map((row) => row.textContent);
  expect(rows).toEqual([
    "Clear old tool resultssuggestedfrees ≈ 6.0K · no model call",
    "Summarise earlier turnsfrees ≈ 6.0K · one call to qwen3:27b",
    "Grow the window to 64K+1.9 GB memory · reloads the model",
    "Continue on a larger modeldeepseek-chat · 128K · under $0.01 a turn · asks first",
  ]);
  expect(within(popover).getByRole("button", { name: "Open the trace" })).toBeTruthy();
});

test("a click runs the action, closes the popover, and the chip drops when golem says what it freed", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  await user.click(chip());
  const popover = await screen.findByRole("dialog", { name: "Context" });
  await waitFor(() => expect(rowOf(popover, /^Clear old tool results/).hasAttribute("disabled")).toBe(false));
  await user.click(rowOf(popover, /^Clear old tool results/));
  expect(fake.raw.compactSession).toHaveBeenCalledWith("a", "clear", undefined);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Context" })).toBeNull());
  act(() => fake.emitEvent(ev("a", "context.changed", { action: "cleared", before_tokens: 9000, after_tokens: 1000, count: 2, room: 28672 })));
  await waitFor(() => expect(chip().textContent).toMatch(/57%.*· 2 cleared/));
  // The call's messages are out of date until the next turn.
  await user.click(chip());
  const again = await screen.findByRole("dialog", { name: "Context" });
  await waitFor(() => expect(within(again).getAllByText("changed just now: the next turn shows what is left")).toHaveLength(2));
  expect(rowOf(again, /^Clear old tool results/).hasAttribute("disabled")).toBe(true);
});

test("summarise and grow call the daemon with their own action", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  await user.click(chip());
  let popover = await screen.findByRole("dialog", { name: "Context" });
  await waitFor(() => expect(rowOf(popover, /^Summarise earlier turns/).hasAttribute("disabled")).toBe(false));
  await user.click(rowOf(popover, /^Summarise earlier turns/));
  expect(fake.raw.compactSession).toHaveBeenLastCalledWith("a", "summarise", undefined);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Context" })).toBeNull());
  await user.click(chip());
  popover = await screen.findByRole("dialog", { name: "Context" });
  await waitFor(() => expect(rowOf(popover, /^Grow the window to 64K/).hasAttribute("disabled")).toBe(false));
  await user.click(rowOf(popover, /^Grow the window to 64K/));
  expect(fake.raw.compactSession).toHaveBeenLastCalledWith("a", "grow", undefined);
});

test("a refused grow keeps the popover open and says why", async () => {
  const fake = await setup();
  fake.raw.compactSession.mockRejectedValue(rpcError(-32602, "this Mac cannot hold a larger window for qwen3:27b"));
  const user = userEvent.setup();
  await user.click(chip());
  const popover = await screen.findByRole("dialog", { name: "Context" });
  await waitFor(() => expect(rowOf(popover, /^Grow the window to 64K/).hasAttribute("disabled")).toBe(false));
  await user.click(rowOf(popover, /^Grow the window to 64K/));
  expect((await within(popover).findByRole("alert")).textContent).toBe("this Mac cannot hold a larger window for qwen3:27b");
  expect(screen.getByRole("dialog", { name: "Context" })).toBeTruthy();
});

test("a larger model turns the route to auto, where a paid model asks first", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  await user.click(chip());
  const popover = await screen.findByRole("dialog", { name: "Context" });
  await waitFor(() => expect(rowOf(popover, /^Continue on a larger model/).hasAttribute("disabled")).toBe(false));
  await user.click(rowOf(popover, /^Continue on a larger model/));
  expect(fake.raw.setRoute).toHaveBeenCalledWith("a", "auto");
});

test("the footer link keeps the way to the trace", async () => {
  await setup();
  const user = userEvent.setup();
  await user.click(chip());
  await user.click(await screen.findByRole("button", { name: "Open the trace" }));
  await waitFor(() => expect(location.pathname + location.search).toBe(inspectPath("a", "m1")));
});

test("a hosted model has no grow row", async () => {
  await setup({ provider: "deepseek", name: "deepseek-chat", planned: false });
  const user = userEvent.setup();
  await user.click(chip());
  const popover = await screen.findByRole("dialog", { name: "Context" });
  await waitFor(() => expect(within(popover).getByText("Clear old tool results")).toBeTruthy());
  expect(within(popover).queryByText(/Grow the window/)).toBeNull();
});

test("a cut prompt shows the banner with the two best actions, and nothing otherwise", async () => {
  const fake = await setup({ cut: "yes" });
  const banner = await screen.findByText("The model no longer sees the start of this chat.");
  const bar = banner.closest('[role="alert"]') as HTMLElement;
  await waitFor(() => expect(within(bar).getAllByRole("button").map((button) => button.textContent)).toEqual(["Clear old tool results", "Summarise earlier turns"]));
  await userEvent.setup().click(within(bar).getByRole("button", { name: "Clear old tool results" }));
  expect(fake.raw.compactSession).toHaveBeenCalledWith("a", "clear", undefined);
  act(() => fake.emitEvent(ev("a", "context.changed", { action: "cleared", before_tokens: 9000, after_tokens: 1000, count: 2 })));
  await waitFor(() => expect(screen.queryByText("The model no longer sees the start of this chat.")).toBeNull());
});

test("no banner when the prompt was not cut", async () => {
  await setup({ cut: "no" });
  await wait();
  expect(screen.queryByText("The model no longer sees the start of this chat.")).toBeNull();
});

const base: ContextActionsInput = {
  used: 27000,
  window: 32768,
  source: "planned",
  session: { profile: null, provider: "ollama", name: "qwen3:27b" },
  models: MODELS,
  messages: MESSAGES as never,
  keepResults: 4,
  keepTurns: 4,
  memory: MEMORY,
  route: "pinned",
  busy: false,
};

const STATES: [string, number, number | null, Partial<ContextActionsInput>][] = [
  ["normal", 14000, 32768, {}],
  ["high", 27000, 32768, {}],
  ["full", 31500, 32768, {}],
  ["hosted", 90000, 128000, { session: { profile: null, provider: "deepseek", name: "deepseek-chat" }, source: "unknown" }],
  ["unknown window", 1300, null, { window: null, source: "unknown" }],
];

for (const [label, used, window, extra] of STATES) {
  for (const theme of ["slip", "kiln"]) {
    test(`the popover of the ${label} state passes axe in ${theme}`, async () => {
      document.documentElement.dataset.theme = theme;
      const actions = contextActions({ ...base, used, ...extra });
      const run = vi.fn(async () => {});
      render(<ContextChipView used={used} window={window} onOpen={() => {}} panel={{ reserve: window === null ? null : 4096, source: extra.source ?? "planned", actions, onRun: run, onOpenTrace: () => {} }} />);
      await userEvent.setup().click(chip());
      const popover = await screen.findByRole("dialog", { name: "Context" });
      expect(within(popover).getAllByRole("listitem").length).toBe(actions.length);
      const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }
}

test("the high state marks the first enabled row as suggested, the normal one marks none", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<ContextChipView used={14000} window={32768} onOpen={() => {}} panel={{ reserve: 4096, source: "planned", actions: contextActions(base), onRun: async () => {}, onOpenTrace: () => {} }} />);
  await user.click(chip());
  expect(within(await screen.findByRole("dialog")).queryByText("suggested")).toBeNull();
  unmount();
  render(<ContextChipView used={27000} window={32768} onOpen={() => {}} panel={{ reserve: 4096, source: "planned", actions: contextActions(base), onRun: async () => {}, onOpenTrace: () => {} }} />);
  await user.click(chip());
  expect(within(await screen.findByRole("dialog")).getAllByText("suggested")).toHaveLength(1);
});

test("the banner view draws its text and runs a button", async () => {
  const onRun = vi.fn(async () => {});
  const actions = contextActions(base).slice(0, 2);
  render(<ContextBannerView text="The model no longer sees the start of this chat." actions={actions} onRun={onRun} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Summarise earlier turns" }));
  expect(onRun).toHaveBeenCalledWith("summarise");
});
