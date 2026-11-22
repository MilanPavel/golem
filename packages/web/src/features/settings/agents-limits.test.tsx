import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { AgentInfo } from "../../store/agents.ts";
import type { ModelListResult } from "../../store/models.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { SAMPLE_AGENTS, SAMPLE_CONFIG_LIMITS } from "./agents-sample.ts";
import { AgentsPage } from "./agents-section.tsx";
import { FinishedHelpers } from "./agents-keep.tsx";
import { settingsContextStore } from "./index.ts";

const FOLDER = "/Users/you/repos/golem";
const noContrast = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

function listing(tiers: ("local" | "frontier")[]): ModelListResult {
  return {
    default: `${tiers[0] === "local" ? "ollama" : "anthropic"}/m0`,
    providers: [],
    setup: { ollama_installed: true, ollama_running: true },
    models: tiers.map((tier, at) => ({
      ref: `${tier === "local" ? "ollama" : "anthropic"}/m${at}`,
      label: `M${at}`,
      provider: tier === "local" ? "ollama" : "anthropic",
      source: "installed",
      status: "ready",
      price: { input: 0, output: 0 },
      tier,
    })),
  } as ModelListResult;
}

function mount(agents: AgentInfo[], values: Record<string, number | null> = {}, models?: ModelListResult) {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockResolvedValue({ agents });
  fake.raw.agentsKeep.mockResolvedValue({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 30, ...values } });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  if (models !== undefined) fake.raw.listModels.mockResolvedValue(models);
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  act(() => {
    fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", FOLDER));
  });
  settingsContextStore.set({ sessionId: "a", cwd: FOLDER });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, user: userEvent.setup(), ...view };
}

const band = (): HTMLElement => screen.getByRole("region", { name: "Limits for every helper" });
const triage = SAMPLE_AGENTS.find((agent) => agent.name === "triage")!;

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
});

test("the facts show five limits and name the ones config.toml sets", async () => {
  mount([SAMPLE_CONFIG_LIMITS]);
  const limits = await screen.findByRole("region", { name: "Limits" });
  expect(limits.textContent).toContain("25tool callsset in config.toml");
  expect(limits.textContent).toContain("10 mintime");
  expect(limits.textContent).toContain("no limittokens");
  expect(limits.textContent).toContain("$0.50costset in config.toml");
  expect(limits.textContent?.match(/set in config\.toml/g)).toHaveLength(2);
});

test("editing one field sends only that key", async () => {
  const { fake, user } = mount(SAMPLE_AGENTS);
  await user.click(await screen.findByRole("button", { name: /^triage\b/ }));
  const limits = screen.getByRole("region", { name: "Limits" });
  await user.click(within(limits).getByRole("button", { name: "Edit limits" }));
  const calls = within(limits).getByRole("textbox", { name: "Tool calls calls" }) as HTMLInputElement;
  expect(calls.value).toBe("15");
  await user.clear(calls);
  await user.type(calls, "20");
  fake.raw.setAgentLimits.mockResolvedValue({ ...triage, limits: { ...triage.limits, max_calls: 20 } });
  await user.click(within(limits).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fake.raw.setAgentLimits).toHaveBeenCalledWith("triage", { max_calls: 20 }, FOLDER));
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Limits" })).queryByRole("form")).toBeNull());
  expect(screen.getByRole("region", { name: "Limits" }).textContent).toContain("20tool calls");
});

test("an emptied field goes in clear, and the hint says what that means", async () => {
  const { fake, user } = mount([{ ...triage, limits: { max_calls: 15, max_cost_usd: 0.5 } }]);
  await user.click(await screen.findByRole("button", { name: "Edit limits" }));
  expect(screen.getByText(/An empty field means no limit of your own/)).toBeTruthy();
  await user.clear(within(screen.getByRole("form", { name: "Limits of triage" })).getByRole("textbox", { name: "Cost US dollars" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fake.raw.setAgentLimits).toHaveBeenCalledWith("triage", { clear: ["max_cost"] }, FOLDER));
});

test("a refusal stays in the form with what was typed, and a bad number is said before sending", async () => {
  const { fake, user } = mount(SAMPLE_AGENTS);
  await user.click(await screen.findByRole("button", { name: /^triage\b/ }));
  await user.click(screen.getByRole("button", { name: "Edit limits" }));
  const calls = within(screen.getByRole("form", { name: "Limits of triage" })).getByRole("textbox", { name: "Tool calls calls" }) as HTMLInputElement;
  await user.clear(calls);
  await user.type(calls, "0");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a whole number, 1 or more.");
  expect(fake.raw.setAgentLimits).not.toHaveBeenCalled();
  await user.clear(calls);
  await user.type(calls, "99");
  fake.raw.setAgentLimits.mockRejectedValue(rpcError(-32602, "max_calls must be at most 50"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("max_calls must be at most 50");
  expect((within(screen.getByRole("form", { name: "Limits of triage" })).getByRole("textbox", { name: "Tool calls calls" }) as HTMLInputElement).value).toBe("99");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("region", { name: "Limits" }).textContent).toContain("15tool calls");
});

test("a project agent has no Edit and says it is read-only", async () => {
  mount(SAMPLE_AGENTS);
  await user();
  async function user(): Promise<void> {
    await userEvent.click(await screen.findByRole("button", { name: /^docs\b/ }));
  }
  const limits = screen.getByRole("region", { name: "Limits" });
  expect(within(limits).queryByRole("button", { name: "Edit limits" })).toBeNull();
  expect(limits.textContent).toContain("A project agent is read-only here.");
});

test("an agent with a broken file has no Edit", async () => {
  mount(SAMPLE_AGENTS);
  await userEvent.click(await screen.findByRole("button", { name: /^broken-one\b/ }));
  expect(screen.queryByRole("button", { name: "Edit limits" })).toBeNull();
});

test("the band saves the limits of [agents] and shows a field error", async () => {
  const { fake, user } = mount(SAMPLE_AGENTS, { max_calls: 10 });
  await screen.findByText("7 agents");
  await screen.findByRole("region", { name: "Limits for every helper" });
  const box = within(band()).getByRole("textbox", { name: "Tool calls calls" }) as HTMLInputElement;
  expect(box.value).toBe("10");
  expect(screen.getByText("These apply when a type sets none of its own.")).toBeTruthy();
  await user.clear(box);
  await user.type(box, "12{Enter}");
  await waitFor(() => expect(fake.raw.setDefaultAgentLimits).toHaveBeenCalledWith({ max_calls: 12 }));
  const cost = within(band()).getByRole("textbox", { name: "Cost US dollars" });
  fake.raw.setDefaultAgentLimits.mockResolvedValue({ ok: false, errors: [{ path: "agents.max_cost", message: "Input should be greater than or equal to 0" }] });
  await user.type(cost, "2{Enter}");
  const alert = await within(band()).findByRole("alert");
  expect(alert.textContent).toBe("Input should be greater than or equal to 0");
  expect(cost.getAttribute("aria-invalid")).toBe("true");
  await user.clear(box);
  await user.type(box, "x{Enter}");
  expect((await within(band()).findByRole("alert")).textContent).toBe("Enter a whole number, 1 or more.");
  await user.clear(box);
  await user.type(box, "{Enter}");
  await waitFor(() => expect(fake.raw.setDefaultAgentLimits).toHaveBeenLastCalledWith({ clear: ["max_calls"] }));
});

test("a cloud-only setup asks for cost first, a mixed one for calls", async () => {
  mount(SAMPLE_AGENTS, {}, listing(["frontier"]));
  await screen.findByText("7 agents");
  await screen.findByRole("region", { name: "Limits for every helper" });
  await waitFor(() => expect(within(band()).getAllByRole("textbox")[0]!.getAttribute("aria-labelledby")).toMatch(/.+/));
  await waitFor(() => expect(within(band()).getAllByRole("textbox").map((box) => box.closest("div.flex-col")?.textContent)[0]).toMatch(/^Cost/));
});

test("a mixed setup starts with tool calls", async () => {
  mount(SAMPLE_AGENTS, {}, listing(["local", "frontier"]));
  await screen.findByText("7 agents");
  await screen.findByRole("region", { name: "Limits for every helper" });
  expect(within(band()).getAllByRole("textbox")[0]!.closest("div.flex-col")?.textContent).toMatch(/^Tool calls/);
});

test("the gallery states are axe-clean", async () => {
  for (const [agents, start, demo] of [
    [[SAMPLE_CONFIG_LIMITS], "bundled/explorer", undefined],
    [SAMPLE_AGENTS, "user/triage", "limits"],
    [SAMPLE_AGENTS, "user/triage", "limits-error"],
    [SAMPLE_AGENTS, "project/docs", undefined],
  ] as const) {
    const { container, unmount } = render(<AgentsPage agents={agents} start={start} demo={demo} onSetLimits={async () => {}} />);
    expect((await axe.run(container, noContrast)).violations).toEqual([]);
    unmount();
  }
  const { container } = render(<FinishedHelpers values={{ keep_days: 7, keep_problem_days: 30, max_cost: 1 }} errors={{ "agents.max_calls": "Enter a whole number, 1 or more." }} failure={null} onSave={() => {}} setup="cloud" onSaveLimit={() => {}} />);
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});
