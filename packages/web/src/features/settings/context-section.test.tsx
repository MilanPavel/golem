import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { RoutingGetResult } from "../../store/routing.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { settingsContextStore } from "./index.ts";
import { DEFAULT_ROUTING, ROUTING_LISTING, SAMPLE_ROUTING } from "./routing-sample.ts";

const READY = "Window size";

function mount(values: RoutingGetResult | "fail" = DEFAULT_ROUTING, setup?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", "/settings/context");
  const fake = fakeClient();
  if (values === "fail") fake.raw.getRouting.mockRejectedValue(new Error("no routing"));
  else fake.raw.getRouting.mockResolvedValue(values);
  fake.raw.listModels.mockResolvedValue(ROUTING_LISTING);
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.getModelOptions.mockResolvedValue({
    model: "qwen3:8b",
    options: [],
    defaults: { num_ctx: 32768 },
    default_from: { num_ctx: "golem" },
    saved: {},
    session: {},
    memory: { ram_gb: 36, size_gb: 5, kv_gb_per_1k_tokens: 0.1, overhead_gb: 1, fits_share: 0.7, tight_share: 0.85 },
  });
  setup?.(fake);
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, user: userEvent.setup() };
}

afterEach(() => {
  settingsContextStore.set(null);
  document.documentElement.removeAttribute("data-theme");
  history.replaceState(null, "", "/");
});

const radio = (name: string | RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
const box = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const heading = () => screen.findByRole("heading", { name: READY });

test("the tab sits after Routing and shows the values the daemon sends", async () => {
  mount(SAMPLE_ROUTING);
  await heading();
  const tabs = within(screen.getByRole("navigation", { name: "Settings sections" })).getAllByRole("link");
  const names = tabs.map((tab) => tab.textContent);
  expect(names.indexOf("Context")).toBe(names.indexOf("Routing") + 1);
  expect(radio("Fixed").checked).toBe(true);
  expect(box("Window size").value).toBe("16384");
  expect(screen.getByText(/One size for every local model, and golem does not check it/)).toBeTruthy();
  expect(screen.getByRole("region", { name: "Right now" }).textContent).toContain("At 60% full golem clears old tool results, and at 80% it summarises");
});

test("each pill saves the right window", async () => {
  const { fake, user } = mount();
  await heading();
  expect(radio("Auto").checked).toBe(true);
  expect((await screen.findAllByText("32K · planned by golem for this Mac")).length).toBeGreaterThan(0);
  await user.click(radio("Ollama's"));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { window: "ollama" } }));
  await user.click(radio("Fixed"));
  expect(screen.getByText(/One size for every local model/)).toBeTruthy();
  await user.type(box("Window size"), "8192");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { window: 8192 } }));
});

test("the Auto pill saves auto, and hides the warning of Fixed", async () => {
  const { fake, user } = mount({ ...DEFAULT_ROUTING, context: { ...DEFAULT_ROUTING.context, window: "ollama" } });
  await heading();
  expect(radio("Ollama's").checked).toBe(true);
  expect(screen.getByText("golem sends no window, so Ollama picks its own.")).toBeTruthy();
  await user.click(radio("Auto"));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { window: "auto" } }));
  expect(screen.queryByText(/One size for every local model/)).toBeNull();
});

test("the switch redraws the bar for the hosted window", async () => {
  const { user } = mount();
  await heading();
  const wait = (await screen.findByText("the chat grows →")).parentElement as HTMLElement;
  expect(wait.textContent).toContain("32K");
  expect(screen.getByText(/The same settings apply to every model/)).toBeTruthy();
  await user.click(radio(/^qwen\/qwen3-235b · 128K$/));
  expect(wait.textContent).toContain("128K");
  expect(screen.getByText(/Window set by \w+\. Step 1 starts at about 89K, so it rarely runs\./)).toBeTruthy();
  await user.click(radio(/^qwen3:8b · 32K$/));
  expect(wait.textContent).toContain("32K");
});

test("with no hosted model there is no switch, and with no window the bar says so", async () => {
  mount({ ...DEFAULT_ROUTING, picked: { local: null, budget: null, frontier: null } });
  await heading();
  expect(screen.queryByRole("group", { name: "Example:" })).toBeNull();
  expect(screen.getAllByText("The chart shows once the window size is known.").length).toBeGreaterThan(0);
  // The bar is still drawn, as shares, with its own words.
  expect(screen.getByText("reply · 4K")).toBeTruthy();
  const axis = screen.getByText("the chat grows →").parentElement as HTMLElement;
  expect(axis.textContent).toBe("0the chat grows →the window");
});

function options(from: string | undefined, num: number | undefined, saved: Record<string, number> = {}) {
  return {
    model: "qwen3:8b",
    options: [],
    defaults: (num === undefined ? {} : { num_ctx: num }) as Record<string, number>,
    default_from: (from === undefined ? {} : { num_ctx: from }) as Record<string, "golem" | "modelfile" | "ollama">,
    saved,
    session: {},
    memory: { ram_gb: 36, size_gb: 5, kv_gb_per_1k_tokens: 0.1, overhead_gb: 1, fits_share: 0.7, tight_share: 0.85 },
  };
}

test("a window from the Modelfile shows with ≈, why golem has no plan, and in Right now", async () => {
  mount(DEFAULT_ROUTING, (fake) => fake.raw.getModelOptions.mockResolvedValue(options("modelfile", 8192)));
  await heading();
  expect((await screen.findAllByText("≈ 8K · from the model's Modelfile")).length).toBeGreaterThan(0);
  expect(screen.getByText("Golem could not plan one.")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Right now" }).textContent).toContain("qwen3:8b gets a ≈ 8K window (from the model's Modelfile)");
  const axis = screen.getByText("the chat grows →").parentElement as HTMLElement;
  expect(axis.textContent).toContain("≈ 8K");
});

test("Ollama's default and a saved window each say where they come from", async () => {
  mount(DEFAULT_ROUTING, (fake) => fake.raw.getModelOptions.mockResolvedValue(options("ollama", 4096)));
  await heading();
  expect((await screen.findAllByText("≈ 4K · Ollama's default")).length).toBeGreaterThan(0);
  cleanup();
  mount(DEFAULT_ROUTING, (fake) => fake.raw.getModelOptions.mockResolvedValue(options("golem", 32768, { num_ctx: 8192 })));
  await heading();
  expect((await screen.findAllByText("8K · set for this model")).length).toBeGreaterThan(0);
});

test("with no window the page says why, and when it will show", async () => {
  mount(DEFAULT_ROUTING, (fake) => fake.raw.getModelOptions.mockResolvedValue(options(undefined, undefined)));
  await heading();
  expect(await screen.findByText("Golem could not plan one.")).toBeTruthy();
  expect(screen.getByText("Ollama's window shows after the first chat on this model.")).toBeTruthy();
});

test("the switch reads Example and the page says it holds rules", async () => {
  mount();
  await heading();
  await screen.findAllByText("32K · planned by golem for this Mac");
  expect(screen.getByText(/This page holds the rules for every chat\. A chat's live fill is the/).textContent).toBe(
    "This page holds the rules for every chat. A chat's live fill is the ctx chip in the chat.",
  );
  expect(screen.getAllByText("Example:").length).toBeGreaterThan(0);
  expect(screen.queryByText("Show it on")).toBeNull();
});

test("the sliders and steppers save the same keys, and step 2 never starts before step 1", async () => {
  const { fake, user } = mount();
  await heading();
  await user.click(screen.getByRole("button", { name: "Newest results left whole: more" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { keep_results: 5 } }));
  await user.click(screen.getByRole("button", { name: "Newest turns kept word for word: less" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { keep_turns: 3 } }));
  await user.click(screen.getByRole("button", { name: "Room kept for the reply: more" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { reply_reserve: 5120 } }));
  const clear = screen.getByRole("slider", { name: "Start clearing at" });
  fireEvent.change(clear, { target: { value: "75" } });
  fireEvent.keyUp(clear);
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { clear_at: 0.75 } }));
  const compact = screen.getByRole("slider", { name: "Start summarising at" }) as HTMLInputElement;
  // The slider starts five points above step 1: 75 would be at the same place as 70 + 5.
  expect(compact.min).toBe("75");
  expect(compact.max).toBe("95");
  fireEvent.change(compact, { target: { value: "90" } });
  fireEvent.keyUp(compact);
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { compact_at: 0.9 } }));
});

test("the compact slider's lowest step follows clear_at, and it never sends a value at or below it", async () => {
  const { fake } = mount({ ...DEFAULT_ROUTING, context: { ...DEFAULT_ROUTING.context, clear_at: 0.8, compact_at: 0.9 } });
  await heading();
  const compact = screen.getByRole("slider", { name: "Start summarising at" }) as HTMLInputElement;
  expect(compact.min).toBe("85");
  // Below the lowest step the slider stops at it, so 85 is sent and never 75.
  fireEvent.change(compact, { target: { value: "75" } });
  fireEvent.keyUp(compact);
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { compact_at: 0.85 } }));
  const sent = fake.raw.setRouting.mock.calls.map(([patch]) => (patch as { context?: { compact_at?: number } }).context?.compact_at);
  expect(sent.every((value) => value !== undefined && value > 0.8)).toBe(true);
});

test("the exact numbers save as shares and counts", async () => {
  const { fake, user } = mount();
  await heading();
  await user.click(screen.getByText("Exact numbers"));
  await user.clear(box("Clear at"));
  await user.type(box("Clear at"), "65");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { clear_at: 0.65 } }));
  await user.clear(box("Reply reserve"));
  await user.type(box("Reply reserve"), "2048");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { reply_reserve: 2048 } }));
  await user.clear(box("Keep loaded for"));
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { keep_alive: null } }));
});

test("a word in a number box is refused where it is typed and nothing is saved", async () => {
  const { fake, user } = mount();
  await heading();
  await user.click(screen.getByText("Exact numbers"));
  await user.clear(box("Summarise at"));
  await user.type(box("Summarise at"), "high");
  await user.tab();
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a number.");
  expect(fake.raw.setRouting).not.toHaveBeenCalled();
});

test("an error on a setting in Exact numbers opens it", async () => {
  const { fake, user } = mount();
  await heading();
  const details = screen.getByText("Exact numbers").closest("details") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect((screen.getByText("How a long chat plays out").closest("details") as HTMLDetailsElement).open).toBe(false);
  fake.raw.setRouting.mockResolvedValue({ ok: false, errors: [{ path: "context.clear_to", message: "[context] needs 0 < clear_to < clear_at < compact_at < 1" }] });
  await user.click(screen.getByText("Exact numbers"));
  await user.clear(box("Clear to"));
  await user.type(box("Clear to"), "90");
  await user.tab();
  const alert = await screen.findByRole("alert");
  expect(box("Clear to").getAttribute("aria-describedby")).toContain(alert.id);
  expect(details.open).toBe(true);
});

test("a loose error is shown as an alert", async () => {
  const { fake, user } = mount();
  await heading();
  fake.raw.setRouting.mockRejectedValueOnce(new Error("the daemon is gone"));
  await user.click(radio("Ollama's"));
  expect((await screen.findByRole("alert")).textContent).toContain("the daemon is gone");
});

test("a failed read shows the error and Retry reads again", async () => {
  const { fake, user } = mount("fail");
  expect((await screen.findByRole("alert")).textContent).toContain("no routing");
  fake.raw.getRouting.mockResolvedValue(DEFAULT_ROUTING);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await heading()).toBeTruthy();
});

for (const theme of ["slip", "kiln"] as const) {
  test(`the page passes axe in ${theme}`, async () => {
    document.documentElement.setAttribute("data-theme", theme);
    mount(SAMPLE_ROUTING);
    const title = await heading();
    const page = title.closest("section")?.parentElement as HTMLElement;
    const results = await axe.run(page, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
}
