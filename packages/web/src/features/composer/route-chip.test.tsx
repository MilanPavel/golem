import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import type { ListedModel } from "../../store/models.ts";
import { ladderRows, spendRows } from "@golem/view";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { RouteChipView } from "./route-chip.tsx";
import { WaitHintView } from "./wait-hint.tsx";

const CWD = "/Users/you/repos/golem";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

const model = (ref: string, extra: Partial<ListedModel> = {}): ListedModel => ({
  ref,
  label: ref.slice(ref.indexOf("/") + 1),
  provider: ref.slice(0, ref.indexOf("/")),
  source: "remote",
  status: "ready",
  tier: "budget",
  ...extra,
});

const MODELS = [
  model("ollama/qwen3:27b", { tier: "local", source: "installed", ctx: 32768, price: { input: 0, output: 0 } }),
  model("deepseek/deepseek-chat", { price: { input: 0.28, output: 1.1 }, tools: true }),
  model("openrouter/mini", { status: "needs_key", tier: "frontier", price: { input: 5, output: 20 } }),
];
const totals = (usd: number) => ({ calls: 1, input: 1, output: 1, cost_usd: usd, saved_usd: 0 });
const COST = { today: totals(0.42), week: totals(0.42), session: totals(0.03) };

async function setup(models: ListedModel[] = MODELS) {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
  fake.raw.getConfig.mockResolvedValue({
    rules: [],
    routing: { ladder: {}, daily_usd: 2, session_usd: 0.5 },
  } as never);
  fake.raw.getCost.mockResolvedValue(COST as never);
  fake.raw.listModels.mockResolvedValue({
    default: "ollama/qwen3:27b",
    models,
    providers: [],
    setup: { ollama_installed: true, ollama_running: true, keys: [], default_status: "ready" },
  } as never);
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
    fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_provider: "ollama", model_name: "qwen3:27b", title: "UTF-8 split" }));
  });
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

const chip = () => screen.getByRole("button", { name: /^Route: / });
const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const notice = () =>
  Array.from(document.querySelectorAll('[role="status"]'))
    .map((node) => node.textContent ?? "")
    .find((text) => text !== "") ?? null;

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(box());
  await user.type(box(), `${text}{Enter}`);
  await wait();
}

test("the chip sits left of the permission chip and follows the session's route", async () => {
  const fake = await setup();
  await waitFor(() => expect(chip().textContent).toBe("pinned"));
  const mode = screen.getByRole("button", { name: /^Permission mode: / });
  expect(chip().compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "auto" })));
  await waitFor(() => expect(chip().textContent).toBe("auto"));
  expect(chip().getAttribute("aria-label")).toBe("Route: auto. Change it.");
});

test("opening the popover reads the spend once, shows the ladder, and Auto sets the route", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  expect(fake.raw.getCost).not.toHaveBeenCalled();
  await user.click(chip());
  const popover = await screen.findByRole("dialog");
  expect(await within(popover).findByText("Today $0.42 of $2.00")).toBeTruthy();
  expect(within(popover).getByText("This session $0.03 of $0.50")).toBeTruthy();
  expect(fake.raw.getCost).toHaveBeenCalledWith("a");
  expect(within(popover).getAllByRole("progressbar")).toHaveLength(2);
  const rows = within(popover).getAllByRole("listitem").map((row) => row.textContent);
  expect(rows).toEqual(["localqwen3:27bready · free", "budgetdeepseek-chatready · $0.28 / M in", "frontiernoneno model"]);
  const radios = within(popover).getAllByRole("radio");
  expect(radios.map((item) => item.textContent)).toEqual(["Pinned", "Local only", "Auto"]);
  expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
  await user.click(within(popover).getByRole("radio", { name: "Auto" }));
  expect(fake.raw.setRoute).toHaveBeenCalledWith("a", "auto");
  expect(within(popover).getByRole("link", { name: "Routing settings" }).getAttribute("href")).toBe("/settings/config");
  expect(fake.raw.getCost).toHaveBeenCalledTimes(1);
});

test("a refused change shows on the dock's error line", async () => {
  const fake = await setup();
  fake.raw.setRoute.mockRejectedValue(rpcError(-32000, "no such route"));
  const user = userEvent.setup();
  await user.click(chip());
  await user.click(await screen.findByRole("radio", { name: "Local only" }));
  await waitFor(() => expect(document.querySelector('[data-dock] [role="alert"]')?.textContent).toBe("no such route"));
});

test("/route reports, sets, and says why", async () => {
  const fake = await setup();
  const user = userEvent.setup();
  await say(user, "/route");
  expect(notice()).toContain("Route: pinned.");
  await say(user, "/route auto");
  expect(fake.raw.setRoute).toHaveBeenLastCalledWith("a", "auto");
  expect(notice()).toBe("Route: auto. It applies from the next turn.");
  await say(user, "/route why");
  expect(notice()).toBe("No model was routed in this chat yet.");
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "auto" })));
  act(() =>
    fake.emitEvent(
      ev("a", "model.routed", {
        model_profile: "deepseek/deepseek-chat",
        provider: "deepseek",
        model: "deepseek-chat",
        tier: "budget",
        reason: "fit",
        detail: "did not fit in 32K on ollama/qwen3:27b",
        rejected: [{ ref: "ollama/qwen3:27b", tier: "local", why: "does not fit: 41.5K of 32K" }],
      }),
    ),
  );
  await say(user, "/route why");
  expect(notice()).toBe(
    "Route: auto · reason: fit. deepseek-chat picked: did not fit in 32K on ollama/qwen3:27b. Left out: ollama/qwen3:27b (does not fit: 41.5K of 32K)",
  );
  fake.raw.setRoute.mockRejectedValue(rpcError(-32000, "refused"));
  await say(user, "/route local");
  expect(document.querySelector('[data-dock] [role="alert"]')?.textContent).toBe("refused");
  await say(user, "/route loud");
  expect(notice()).toContain("/route, or /route pinned");
});

const ladder = ladderRows(MODELS, null, { profile: "local", provider: "ollama", name: "qwen3:27b", tier: "local" });
const spend = spendRows(COST as never, { ladder: {}, daily_usd: 2, session_usd: 0.5 });

test("without caps the popover shows the amounts only", () => {
  render(<RouteChipView mode="local" ladder={ladder} spend={spendRows(COST as never, { ladder: {} })} onSelect={() => {}} onNavigate={() => {}} />);
  return userEvent
    .setup()
    .click(chip())
    .then(async () => {
      const popover = await screen.findByRole("dialog");
      expect(within(popover).getByText("Today $0.42")).toBeTruthy();
      expect(within(popover).queryByRole("progressbar")).toBeNull();
      expect(within(popover).getByRole("radio", { name: "Local only" }).getAttribute("aria-checked")).toBe("true");
    });
});

test("a tier that is not ready is grey and offers Add key", async () => {
  const onNavigate = vi.fn();
  const rows = ladderRows([MODELS[0]!, model("openrouter/mini", { status: "needs_key", price: { input: 0.1, output: 0.4 } })], null, null);
  render(<RouteChipView mode="auto" ladder={rows} spend={[]} onSelect={() => {}} onNavigate={onNavigate} />);
  const user = userEvent.setup();
  await user.click(chip());
  const popover = await screen.findByRole("dialog");
  const budget = within(popover).getByText("budget").closest("li")!;
  expect(budget.getAttribute("data-ready")).toBe("false");
  expect(budget.className).toContain("text-faint");
  await user.click(within(budget).getByRole("link", { name: "Add key" }));
  expect(onNavigate).toHaveBeenCalledWith("/settings/keys");
});

for (const theme of ["slip", "kiln"]) {
  for (const mode of ["pinned", "local", "auto"] as const) {
    test(`the chip and its popover pass axe in ${theme}, on ${mode}`, async () => {
      document.documentElement.dataset.theme = theme;
      render(<RouteChipView mode={mode} ladder={ladder} spend={spend} onSelect={() => {}} onNavigate={() => {}} />);
      await userEvent.setup().click(screen.getByRole("button", { name: new RegExp(`^Route: ${mode}`) }));
      await screen.findByRole("dialog");
      const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      expect(results.violations).toEqual([]);
    });
  }
}

test("the wait hint draws its line, and nothing when it is empty", () => {
  const { container, rerender } = render(<WaitHintView text="≈ 3 min to first token on qwen3:27b" />);
  expect(container.textContent).toBe("≈ 3 min to first token on qwen3:27b");
  rerender(<WaitHintView text="" />);
  expect(container.textContent).toBe("");
});

test("the dock shows the wait hint above the composer once a slow local call has reported its input", async () => {
  const fake = await setup([{ ...MODELS[0]!, speed: { prompt_tps: 50, samples: 3 } }, MODELS[1]!]);
  expect(screen.queryByText(/to first token/)).toBeNull();
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "auto" })));
  act(() => fake.emitEvent(ev("a", "model.call.started", { message_id: "m1", model: "qwen3:27b", tier: "local", context_window: 32768 })));
  act(() => fake.emitEvent(ev("a", "model.call.completed", { message_id: "m1", usage: { input: 9000, output: 100 } })));
  await waitFor(() =>
    expect(screen.getByText("≈ 3 min to first token on qwen3:27b · deepseek-chat ≈ 2 s for ≈ $0.01")).toBeTruthy(),
  );
});
