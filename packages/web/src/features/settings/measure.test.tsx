import type { EvalMeasurement, EvalPlanArm, EvalRun, EvalSummary, EvalUpdate } from "../../store/evals.ts";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { SAMPLE_AGENTS } from "./agents-sample.ts";
import { showAgentsTab } from "./agents-tab.ts";
import { settingsContextStore } from "./index.ts";

const FOLDER = "/Users/you/repos/golem";
const noContrast = { rules: { "color-contrast": { enabled: false } } };

const local = (over: Partial<EvalPlanArm> = {}): EvalPlanArm => ({ name: "local-32k", label: "Local, 32K window", kind: "local", tier: "local", model: "ollama/qwen3.8:27b", window: 32768, asks: 10, minutes: 35, verdict: "tight", needed_gb: 21.1, ram_gb: 36, free_gb: 24.3, reason: "It fits, but it takes more than half of the memory.", ...over });
const big = (): EvalPlanArm => local({ name: "local-128k", label: "Local, 128K window", verdict: "too_big", needed_gb: 26.9, reason: "Does not fit on this Mac with this model." });
const paid = (): EvalPlanArm => ({ name: "budget", label: "Budget cloud", kind: "cloud", tier: "budget", model: "claude-haiku", window: 32768, asks: 10, minutes: 5, cost_usd: 0.4, reason: "Costs money." });
const PLAN = { arms: [local(), big(), paid()], running: null };

const run = (over: Partial<EvalRun> = {}): EvalRun => ({ arm: "local-32k", ask: "Read the repo", mode: "off", end: "completed", quality: 0.8, seconds: 72, window_left: 0.4, helpers_started: 0, ...over });
const measurement = (over: Partial<EvalMeasurement>): EvalMeasurement => ({ id: "m1", arms: [{ name: "local-32k", model: "qwen3.8:27b" }], runs: [], started_at: new Date().toISOString(), state: "running", ...over });
const item = (over: Partial<EvalSummary> = {}): EvalSummary => ({ id: "m1", arms: [{ name: "local-32k", model: "qwen3.8:27b" }], runs_played: 4, runs_total: 20, started_at: new Date().toISOString(), state: "running", ...over });

const RUNNING = measurement({ runs: [run({ ask: "Small" }), run({ ask: "Big", mode: "on", end: "running", quality: null, seconds: null, window_left: null }), run({ ask: "Later", end: "pending", quality: null })] });
const STOPPED = measurement({ state: "stopped", stop_reason: "Ollama stopped answering.", runs: [run({}), run({ ask: "Big", mode: "on", end: "not_run", quality: null }), run({ ask: "Last", end: "not_run", quality: null })] });
const DONE = measurement({
  state: "done",
  ended_at: new Date(Date.now() + 90_000).toISOString(),
  runs: [run({ ask: "Large" }), run({ ask: "Large", mode: "on", quality: 0.9, window_left: 0.6, helpers_started: 3 }), run({ ask: "Small" }), run({ ask: "Small", mode: "on", helpers_started: 0 })],
  proposal: {
    pairs: 2,
    wins: 1,
    numbers: [
      { key: "read_share", current: 0.3, proposed: 0.42, measured: true, note: "smallest reading where a helper won" },
      { key: "fill_share", current: 0.85, proposed: 0.8, measured: true },
      { key: "job_share", current: 0.1, proposed: null, measured: false, note: "from the cloud arms only" },
      { key: "price_ratio", current: 3, proposed: null, measured: false },
    ],
  },
});

function mount(opts: { plan?: { arms: EvalPlanArm[]; running: string | null }; list?: EvalSummary[]; get?: EvalMeasurement } = {}) {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockResolvedValue({ agents: SAMPLE_AGENTS });
  fake.raw.agentsKeep.mockResolvedValue({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 30, use_helpers: "ask" } });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.evalsPlan.mockResolvedValue(opts.plan ?? PLAN);
  fake.raw.evalsList.mockResolvedValue({ measurements: opts.list ?? [] });
  if (opts.get !== undefined) fake.raw.evalsGet.mockResolvedValue({ measurement: opts.get });
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
  return { user: userEvent.setup(), fake, ...view };
}

async function openMeasure(m: ReturnType<typeof mount>) {
  await screen.findByText("7 agents");
  await m.user.click(screen.getByRole("tab", { name: /^Measure/ }));
  return screen.getByRole("tabpanel", { name: /^Measure/ });
}

const emit = (m: ReturnType<typeof mount>, update: EvalUpdate) => {
  act(() => {
    m.fake.emitEval(update);
  });
};

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
  showAgentsTab("agents");
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.restoreAllMocks();
  showAgentsTab("agents");
});

test("the list shows each arm with its memory and verdict; a too big arm cannot be ticked", async () => {
  const m = mount();
  const panel = await openMeasure(m);
  const arms = await within(panel).findByRole("list", { name: "Arms of the measurement" });
  const rows = within(arms).getAllByRole("listitem");
  expect(rows).toHaveLength(3);
  expect(rows[0]?.textContent).toContain("needs 21.1 GB of 36 GB, 24.3 GB free");
  expect(rows[0]?.textContent).toContain("TIGHT");
  const tooBig = within(rows[1] as HTMLElement).getByRole("checkbox") as HTMLInputElement;
  expect(tooBig.disabled).toBe(true);
  expect(rows[1]?.textContent).toContain("TOO BIG");
  expect(rows[1]?.textContent).toContain("Does not fit on this Mac with this model.");
  expect(rows[2]?.textContent).toContain("no memory, about $0.40");
  expect((within(rows[2] as HTMLElement).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect((within(panel).getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  expect(panel.textContent).toContain("Nothing chosen yet");
  expect(panel.textContent).not.toMatch(/\beval/i);
});

test("a tight arm starts only after the box, and sends allow_tight; then the run opens", async () => {
  const m = mount({ get: RUNNING });
  const panel = await openMeasure(m);
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
  const start = () => within(panel).getByRole("button", { name: "Start" }) as HTMLButtonElement;
  await m.user.click(within(panel).getByRole("checkbox", { name: "Local, 32K window" }));
  expect(start().disabled).toBe(true);
  expect(panel.textContent).toContain("Tick the box on the left to go on");
  await m.user.click(within(panel).getByRole("checkbox", { name: "I saved my work. Run although memory is tight." }));
  expect(start().disabled).toBe(false);
  expect(panel.textContent).toContain("20 runs · about 35 min · $0 · one model, one request at a time");
  await m.user.click(start());
  await waitFor(() => expect(m.fake.raw.evalsStart).toHaveBeenCalledWith({ arms: ["local-32k"], allow_tight: true }));
  await within(panel).findByRole("button", { name: "‹ All measurements" });
  expect(within(panel).getByRole("progressbar", { name: "Progress of the measurement" })).toBeTruthy();
});

test("a paid arm shows its cost, is not ticked at first, and starts without allow_tight", async () => {
  const m = mount({ get: RUNNING });
  const panel = await openMeasure(m);
  const box = (await within(panel).findByRole("checkbox", { name: "Budget cloud" })) as HTMLInputElement;
  expect(box.checked).toBe(false);
  await m.user.click(box);
  expect(panel.textContent).toContain("20 runs · about 5 min · about $0.40");
  await m.user.click(within(panel).getByRole("button", { name: "Start" }));
  await waitFor(() => expect(m.fake.raw.evalsStart).toHaveBeenCalledWith({ arms: ["budget"], allow_tight: false }));
});

test("with no local arm that can run, the list says so and cloud arms still start", async () => {
  const m = mount({ plan: { arms: [local({ verdict: "no_room", reason: "Not enough memory is free now." }), paid()], running: null } });
  const panel = await openMeasure(m);
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
  expect(panel.textContent).toContain("golem will not start a run that would freeze the Mac");
  expect(panel.textContent).toContain("NO ROOM NOW");
  expect((within(panel).getByRole("checkbox", { name: "Local, 32K window" }) as HTMLInputElement).disabled).toBe(true);
  await m.user.click(within(panel).getByRole("button", { name: "Check memory again" }));
  await waitFor(() => expect(m.fake.raw.evalsPlan.mock.calls.length).toBeGreaterThan(1));
});

test("Start is off while a measurement runs, and the list says so with a way in", async () => {
  const m = mount({ plan: { ...PLAN, running: "m1" }, list: [item()], get: RUNNING });
  const panel = await openMeasure(m);
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
  expect(panel.textContent).toContain("A measurement is running: run 5 of 20.");
  expect(panel.textContent).toContain("Wait for the running one, or stop it");
  await m.user.click(within(panel).getByRole("checkbox", { name: "Budget cloud" }));
  expect((within(panel).getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("tab", { name: /^Measure/ }).querySelector("[data-measuring]")).not.toBeNull();
  await m.user.click(within(panel).getByRole("button", { name: "Open it" }));
  await within(panel).findByRole("progressbar", { name: "Progress of the measurement" });
});

test("a running measurement follows the notifications, goes on when the person goes back, and Stop stops it", async () => {
  const m = mount({ plan: { ...PLAN, running: "m1" }, list: [item()], get: RUNNING });
  const panel = await openMeasure(m);
  await m.user.click(await within(panel).findByRole("button", { name: /Open the measurement/ }));
  await within(panel).findByRole("progressbar", { name: "Progress of the measurement" });
  expect(panel.textContent).toContain("Run 2 of 3");
  emit(m, { kind: "progress", progress: { id: "m1", arm: "local-32k", mode: "on", ask: "Big", index: 2, total: 3, elapsed: 125, state: "running", memory_used_gb: 33, memory_total_gb: 36 } });
  await waitFor(() => expect(panel.textContent).toContain("33 of 36 GB"));
  expect(panel.textContent).toContain("helpers on · Big");
  expect(panel.textContent).toContain("2:05 gone");
  // Going back does not stop it: the tab keeps its dot and the list says it runs.
  await m.user.click(within(panel).getByRole("button", { name: "‹ All measurements" }));
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
  expect(m.fake.raw.evalsStop).not.toHaveBeenCalled();
  expect(screen.getByRole("tab", { name: /^Measure/ }).querySelector("[data-measuring]")).not.toBeNull();
  await m.user.click(within(panel).getByRole("button", { name: "Open it" }));
  await m.user.click(await within(panel).findByRole("button", { name: "Stop" }));
  await waitFor(() => expect(m.fake.raw.evalsStop).toHaveBeenCalledWith("m1"));
});

test("when the run ends, the page reads it again and shows the stopped state", async () => {
  const m = mount({ plan: { ...PLAN, running: "m1" }, list: [item()], get: RUNNING });
  const panel = await openMeasure(m);
  await m.user.click(await within(panel).findByRole("button", { name: /Open the measurement/ }));
  await within(panel).findByRole("progressbar", { name: "Progress of the measurement" });
  m.fake.raw.evalsGet.mockResolvedValue({ measurement: STOPPED });
  m.fake.raw.evalsList.mockResolvedValue({ measurements: [item({ state: "stopped", runs_played: 1 })] });
  m.fake.raw.evalsPlan.mockResolvedValue(PLAN);
  emit(m, { kind: "ended", ended: { id: "m1", state: "stopped", stop_reason: "Ollama stopped answering." } });
  await within(panel).findByText(/Ollama stopped answering\./);
  expect(screen.getByRole("tab", { name: /^Measure/ }).querySelector("[data-measuring]")).toBeNull();
});

test("a stopped measurement says why and plays the rest, or is deleted and the list comes back", async () => {
  const m = mount({ list: [item({ state: "stopped", runs_played: 1 })], get: STOPPED, plan: { arms: [local({ verdict: "fits" }), paid()], running: null } });
  const panel = await openMeasure(m);
  await m.user.click(await within(panel).findByRole("button", { name: /Open the measurement/ }));
  await within(panel).findByText(/Stopped after 1 of 3 runs\./);
  expect(panel.textContent).toContain("Ollama stopped answering. 1 run is kept. 2 were not run and are not counted.");
  expect(within(panel).getAllByText("not run")).toHaveLength(2);
  await m.user.click(within(panel).getByRole("button", { name: "Run the other 2" }));
  await waitFor(() => expect(m.fake.raw.evalsResume).toHaveBeenCalledWith("m1", false));
  await m.user.click(within(panel).getByRole("button", { name: "Delete this measurement" }));
  await waitFor(() => expect(m.fake.raw.evalsDelete).toHaveBeenCalledWith("m1"));
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
});

test("a stopped measurement whose arm is tight again needs the box, and one that does not fit cannot be run", async () => {
  const tight = mount({ list: [item({ state: "stopped" })], get: STOPPED });
  let panel = await openMeasure(tight);
  await tight.user.click(await within(panel).findByRole("button", { name: /Open the measurement/ }));
  const resume = await within(panel).findByRole("button", { name: "Run the other 2" });
  expect((resume as HTMLButtonElement).disabled).toBe(true);
  await tight.user.click(within(panel).getByRole("checkbox", { name: "I saved my work. Run although memory is tight." }));
  expect((resume as HTMLButtonElement).disabled).toBe(false);
  await tight.user.click(resume);
  await waitFor(() => expect(tight.fake.raw.evalsResume).toHaveBeenCalledWith("m1", true));
  tight.unmount();
  showAgentsTab("agents");
  const none = mount({ list: [item({ state: "stopped" })], get: STOPPED, plan: { arms: [local({ verdict: "no_room" })], running: null } });
  panel = await openMeasure(none);
  await none.user.click(await within(panel).findByRole("button", { name: /Open the measurement/ }));
  const blocked = await within(panel).findByRole("button", { name: "Run the other 2" });
  expect((blocked as HTMLButtonElement).disabled).toBe(true);
  expect(panel.textContent).toContain("There is not enough memory to play the rest now.");
});

test("a finished measurement shows off against on and the four numbers; Use these numbers writes them and opens Rules", async () => {
  const m = mount({ list: [item({ state: "done", runs_played: 4, runs_total: 4, proposes: 2 })], get: DONE });
  const panel = await openMeasure(m);
  await m.user.click(await within(panel).findByRole("button", { name: /Open the measurement/ }));
  const table = await within(panel).findByRole("table", { name: "Result" });
  const body = within(table).getAllByRole("row").slice(1);
  expect(body[0]?.textContent).toContain("0.80 → 0.90");
  expect(body[0]?.textContent).toContain("HELPER WINS");
  expect(body[1]?.textContent).toContain("NO HELPER");
  const numbers = within(panel).getByRole("list", { name: "Proposed numbers" });
  expect(within(numbers).getAllByRole("listitem").map((each) => each.textContent)).toEqual([
    "read_share30% 42%smallest reading where a helper won",
    "fill_share85% 80%",
    "job_share10% not measuredfrom the cloud arms only",
    "price_ratio3× not measured",
  ]);
  expect((await axe.run(panel, noContrast)).violations).toEqual([]);
  await m.user.click(within(panel).getByRole("button", { name: "Use these numbers" }));
  await waitFor(() => expect(m.fake.raw.evalsApply).toHaveBeenCalledWith("m1"));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Rules" }).getAttribute("aria-selected")).toBe("true"));
});

test("Keep mine and close goes back to the list without writing; Delete removes it", async () => {
  const m = mount({ list: [item({ state: "done" })], get: DONE });
  const panel = await openMeasure(m);
  await m.user.click(await within(panel).findByRole("button", { name: /Open the measurement/ }));
  await m.user.click(await within(panel).findByRole("button", { name: "Keep mine and close" }));
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
  expect(m.fake.raw.evalsApply).not.toHaveBeenCalled();
  await m.user.click(within(panel).getByRole("button", { name: /Open the measurement/ }));
  await m.user.click(await within(panel).findByRole("button", { name: "Delete" }));
  await waitFor(() => expect(m.fake.raw.evalsDelete).toHaveBeenCalledWith("m1"));
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
});

test("a measurement whose numbers are in use offers Close and no Use these numbers", async () => {
  const m = mount({ list: [item({ state: "done" })], get: { ...DONE, in_use: true } });
  const panel = await openMeasure(m);
  await m.user.click(await within(panel).findByRole("button", { name: /Open the measurement/ }));
  await within(panel).findByRole("button", { name: "Close" });
  expect(within(panel).queryByRole("button", { name: "Use these numbers" })).toBeNull();
  expect(panel.textContent).toContain("These numbers are in use. See them on the Rules tab.");
});

test("a start the daemon refuses is a plain line, and the list stays", async () => {
  const m = mount();
  m.fake.raw.evalsStart.mockRejectedValue(new Error("A measurement is already running."));
  const panel = await openMeasure(m);
  await m.user.click(await within(panel).findByRole("checkbox", { name: "Budget cloud" }));
  await m.user.click(within(panel).getByRole("button", { name: "Start" }));
  expect((await within(panel).findByRole("alert")).textContent).toBe("A measurement is already running.");
  expect(within(panel).getByRole("list", { name: "Arms of the measurement" })).toBeTruthy();
});

test("a lost connection on opening is a line with Retry", async () => {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockResolvedValue({ agents: SAMPLE_AGENTS });
  fake.raw.agentsKeep.mockResolvedValue({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 30 } });
  fake.raw.evalsPlan.mockRejectedValueOnce(new Error("connection lost"));
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  act(() => {
    fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", FOLDER));
  });
  settingsContextStore.set({ sessionId: "a", cwd: FOLDER });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText("7 agents");
  await user.click(screen.getByRole("tab", { name: /^Measure/ }));
  const panel = screen.getByRole("tabpanel", { name: /^Measure/ });
  expect((await within(panel).findByRole("alert")).textContent).toBe("connection lost");
  fake.raw.evalsPlan.mockResolvedValue(PLAN);
  await user.click(within(panel).getByRole("button", { name: "Retry" }));
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
});

test("coming back to Settings shows the run that went on: the dot, and the way in", async () => {
  const first = mount();
  const panel = await openMeasure(first);
  await within(panel).findByRole("list", { name: "Arms of the measurement" });
  expect(screen.getByRole("tab", { name: /^Measure/ }).querySelector("[data-measuring]")).toBeNull();
  first.unmount();
  showAgentsTab("measure");
  const again = mount({ plan: { ...PLAN, running: "m1" }, list: [item()], get: RUNNING });
  await screen.findByRole("list", { name: "Arms of the measurement" });
  await waitFor(() => expect(screen.getByRole("tab", { name: /^Measure/ }).querySelector("[data-measuring]")).not.toBeNull());
  expect(screen.getByRole("tabpanel", { name: /^Measure/ }).textContent).toContain("A measurement is running");
  expect(again.fake.raw.evalsStop).not.toHaveBeenCalled();
});

test("the earlier measurements are listed with the running one first", async () => {
  const m = mount({
    list: [item({ id: "d", state: "done", runs_played: 20, proposes: 2 }), item({ id: "r", state: "running" })],
    plan: { ...PLAN, running: "r" },
  });
  const panel = await openMeasure(m);
  const list = await within(panel).findByRole("list", { name: "Measurements" });
  const rows = within(list).getAllByRole("button");
  expect(rows[0]?.textContent).toContain("Running");
  expect(rows[1]?.textContent).toContain("proposes 2 numbers");
});
