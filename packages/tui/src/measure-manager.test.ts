import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvalAsk, EvalMeasurement, EvalPlanArm, EvalRun, EvalSummary } from "@golem/client";
import type { MeasureLive } from "@golem/view";

import type { Press } from "./keys.ts";
import {
  closedMeasure,
  layoutMeasure,
  measureKeyOf,
  measureListed,
  measureNoticed,
  measureOpened,
  openMeasure,
  pressMeasure,
  type MeasureData,
  type MeasureKey,
  type MeasureState,
} from "./measure-manager.ts";

const NOW = new Date("2026-11-24T16:00:00");
const WHEN = "2026-11-24T14:02:00";

const ARMS: EvalPlanArm[] = [
  { name: "local-32k", label: "Local, 32K window", kind: "local", tier: "local", model: "ollama/qwen3.8:27b", window: 32768, asks: 10, minutes: 35, verdict: "tight", needed_gb: 21.1, ram_gb: 36, free_gb: 24.3 },
  { name: "local-128k", label: "Local, 128K window", kind: "local", tier: "local", model: "ollama/qwen3.8:27b", window: 131072, asks: 10, minutes: 45, verdict: "too_big", needed_gb: 26.9, ram_gb: 36, free_gb: 24.3 },
  { name: "budget", label: "Budget cloud", kind: "cloud", tier: "budget", model: "claude-haiku-5-5", window: 32768, asks: 10, minutes: 5, cost_usd: 0.4 },
  { name: "frontier", label: "Frontier cloud", kind: "cloud", tier: "frontier", model: "claude-opus-5-5", window: 32768, asks: 10, minutes: 8, cost_usd: 6 },
];
const NO_ROOM: EvalPlanArm[] = ARMS.map((arm, at) => (at === 0 ? { ...arm, verdict: "no_room" as const, free_gb: 9.8 } : arm));

const HISTORY: EvalSummary[] = [
  { id: "b", arms: [{ name: "budget", model: "claude-haiku-5-5" }], runs_played: 20, runs_total: 20, started_at: "2026-11-21T09:00:00", state: "done", cost_usd: 0.38 },
];
const RUNNING_ROW: EvalSummary = { id: "m1", arms: [{ name: "local-32k", model: "qwen3.8:27b" }], runs_played: 5, runs_total: 10, started_at: WHEN, state: "running" };

const ASKS = ["Find where a setting is read", "Summarise one file", "Read the whole repo", "Trace a bug across modules", "Compare two designs"];
function runs(played: number, over: "none" | "stopped" = "none"): EvalRun[] {
  const all: EvalRun[] = [];
  let at = 0;
  for (const ask of ASKS) {
    for (const mode of ["off", "on"] as const) {
      const big = ASKS.indexOf(ask) >= 2;
      const base = { arm: "local-32k", ask, mode };
      if (at < played) {
        all.push({ ...base, end: "completed", quality: mode === "on" && big ? 0.9 : 0.8, seconds: mode === "on" && big ? 95 : 70, window_left: mode === "on" && big ? 0.6 : 0.4, helpers_started: mode === "on" && big ? 3 : 0 });
      } else if (at === played && over === "none") {
        all.push({ ...base, end: "running" });
      } else {
        all.push({ ...base, end: over === "stopped" ? "not_run" : "pending" });
      }
      at += 1;
    }
  }
  return all;
}
const ARM = [{ name: "local-32k", model: "qwen3.8:27b" }];
const RUNNING: EvalMeasurement = { id: "m1", arms: ARM, runs: runs(5), started_at: WHEN, state: "running" };
const STOPPED: EvalMeasurement = { id: "m1", arms: ARM, runs: runs(3, "stopped"), started_at: WHEN, state: "stopped", stop_reason: "Ollama stopped answering." };
const DONE: EvalMeasurement = {
  id: "m1",
  arms: ARM,
  runs: runs(10),
  started_at: WHEN,
  ended_at: "2026-11-24T14:36:10",
  state: "done",
  proposal: {
    pairs: 3,
    wins: 3,
    numbers: [
      { key: "read_share", current: 0.3, proposed: 0.42, measured: true, note: "smallest reading where a helper won" },
      { key: "fill_share", current: 0.85, proposed: 0.8, measured: true, note: "the fullest window that still answered well" },
      { key: "job_share", current: 0.1, proposed: null, measured: false, note: "from the cloud arms only: not measured" },
      { key: "price_ratio", current: 3, proposed: null, measured: false, note: "from the cloud arms only: not measured" },
    ],
  },
};
const LIVE: MeasureLive = { id: "m1", index: 6, total: 10, arm: "local-32k", mode: "on", ask: "Read the whole repo", elapsed: 760, memoryUsedGb: 33, memoryTotalGb: 36 };

const data = (over: Partial<MeasureData> = {}): MeasureData => ({ plan: { arms: ARMS }, list: HISTORY, measurement: null, live: null, error: null, busy: false, ...over });
const text = (state: MeasureState, d: MeasureData, columns = 100, rows = 30): string[] =>
  layoutMeasure({ state, data: d, columns, rows, now: NOW }).map((line) => `${line.prefix ?? ""}${line.mark === undefined ? "" : `${line.mark.text} `}${line.text}`);
const press = (state: MeasureState, d: MeasureData, ...keys: MeasureKey[]) => {
  let at = state;
  let action: ReturnType<typeof pressMeasure>["action"] = { kind: "none" };
  for (const key of keys) ({ state: at, action } = pressMeasure(at, d, key, NOW));
  return { state: at, action };
};
const withRun = (id = "m1"): MeasureState => ({ ...openMeasure(), run: { id } });

test("keys: letters, arrows and Esc map to measure keys", () => {
  const p = (name: Press["name"], input = ""): Press => ({ name, input, ctrl: false, meta: false });
  assert.equal(measureKeyOf(p(null, " ")), "space");
  assert.equal(measureKeyOf(p(null, "t")), "saved");
  assert.equal(measureKeyOf(p(null, "x")), "stop");
  assert.equal(measureKeyOf(p(null, "a")), "asks");
  assert.equal(measureKeyOf(p(null, "o")), "open");
  assert.equal(measureKeyOf(p("return")), "enter");
  assert.equal(measureKeyOf(p("escape")), "back");
  assert.equal(measureKeyOf(p(null, "q")), null);
});

test("list, ready: arms with the memory line, a tight tag, earlier ones below", () => {
  const out = text(openMeasure(), data());
  assert.match(out[0]!, /^Agents › Measure +esc back$/);
  assert.ok(out.some((l) => /\[ \] Local, 32K window\s+qwen3\.8:27b\s+needs 21\.1 GB of 36 GB, 24\.3 GB free\s+TIGHT/.test(l)));
  assert.ok(out.some((l) => /\[ \] Local, 128K window.*TOO BIG/.test(l)));
  assert.ok(out.some((l) => /Budget cloud.*no memory, about \$0\.40\s+PAID/.test(l)));
  assert.ok(out.some((l) => l.includes("earlier")));
  assert.ok(out.some((l) => /Done\s+21 Nov\s+Budget · claude-haiku-5-5 · 20 runs · \$0\.38/.test(l)));
  assert.ok(out.some((l) => l === "Nothing chosen yet"));
  assert.ok(out.at(-1)!.includes("space tick"));
});

test("list, no room: a warning shows and the arm can still be ticked", () => {
  const d = data({ plan: { arms: NO_ROOM } });
  const out = text(openMeasure(), d);
  assert.ok(out.some((l) => l.includes("Local, 32K window") && l.includes("NO ROOM NOW")));
  assert.ok(out.some((l) => l.includes("the Mac may stop answering")));
  const asked = press(openMeasure(), d, "space");
  assert.deepEqual(asked.state.list.ticked, ["local-32k"]);
  assert.ok(text(asked.state, d).some((l) => l.includes("I saved my work. Run at my own risk: this can make the Mac stop answering.")));
  assert.equal(press(asked.state, d, "enter").action.kind, "none");
  assert.deepEqual(press(asked.state, d, "saved", "enter").action, { kind: "start", arms: ["local-32k"], allowTight: true, ownRisk: true });
});

test("too big is a warning too: space ticks it, the box says own risk, start sends own_risk", () => {
  const down = press(openMeasure(), data(), "down", "space");
  assert.deepEqual(down.state.list.ticked, ["local-128k"]);
  assert.equal(press(down.state, data(), "enter").action.kind, "none");
  assert.deepEqual(press(down.state, data(), "saved", "enter").action, { kind: "start", arms: ["local-128k"], allowTight: true, ownRisk: true });
});

test("an arm with no model to run still cannot be ticked", () => {
  const missing: EvalPlanArm[] = [{ ...ARMS[0]!, verdict: "unknown", runnable: false, reason: "Ollama does not have qwen3.8:27b. Choose another model, or pull it first." }, ...ARMS.slice(2)];
  const out = press(openMeasure(), data({ plan: { arms: missing } }), "space");
  assert.deepEqual(out.state.list.ticked, []);
  assert.match(out.state.list.notice ?? "", /cannot run: Ollama does not have/);
});

test("a tight arm needs the saved-work box, then starts with allow_tight", () => {
  const ticked = press(openMeasure(), data(), "space");
  assert.deepEqual(ticked.state.list.ticked, ["local-32k"]);
  assert.ok(text(ticked.state, data()).some((l) => l.includes("I saved my work. Run although memory is tight.")));
  const early = press(ticked.state, data(), "enter");
  assert.equal(early.action.kind, "none");
  assert.match(early.state.list.notice ?? "", /Tick the box/);
  const go = press(ticked.state, data(), "saved", "enter");
  assert.deepEqual(go.action, { kind: "start", arms: ["local-32k"], allowTight: true, ownRisk: false });
});

test("a paid arm is never ticked by default, shows its cost, and starts without allow_tight", () => {
  assert.deepEqual(openMeasure().list.ticked, []);
  const ticked = press(openMeasure(), data(), "down", "down", "space");
  assert.ok(text(ticked.state, data()).some((l) => l.includes("enter start") && l.includes("about $0.4")));
  assert.deepEqual(press(ticked.state, data(), "enter").action, { kind: "start", arms: ["budget"], allowTight: false, ownRisk: false });
});

test("t with nothing tight to confirm only says so", () => {
  const out = press(openMeasure(), data({ plan: { arms: ARMS.slice(2) } }), "saved");
  assert.equal(out.state.list.saved, false);
  assert.match(out.state.list.notice ?? "", /Nothing ticked needs it/);
});

test("one at a time: start is refused while a measurement runs", () => {
  const d = data({ list: [RUNNING_ROW, ...HISTORY], plan: { arms: ARMS, running: "m1" } });
  const out = press(openMeasure(), d, "down", "down", "space", "enter");
  assert.equal(out.action.kind, "none");
  assert.match(out.state.list.notice ?? "", /Wait for the running one/);
  assert.ok(text(openMeasure(), d).some((l) => /Running\s+Today 14:02.*run 6 of 10/.test(l)));
});

test("a busy call refuses a second start", () => {
  const out = press(openMeasure(), data({ busy: true }), "down", "down", "space", "enter");
  assert.equal(out.action.kind, "none");
  assert.match(out.state.list.notice ?? "", /Wait a moment/);
});

test("enter on an earlier measurement opens its run; d asks, y deletes, anything else cancels", () => {
  const onRow = press(openMeasure(), data(), "down", "down", "down", "down");
  const opened = pressMeasure(onRow.state, data(), "enter", NOW);
  assert.deepEqual(opened.action, { kind: "open", id: "b" });
  assert.deepEqual(opened.state.run, { id: "b" });
  const ask = press(onRow.state, data(), "delete");
  assert.equal(ask.state.list.confirm, "b");
  assert.ok(text(ask.state, data()).some((l) => l.includes("Delete this measurement?")));
  assert.deepEqual(press(ask.state, data(), "yes").action, { kind: "delete", id: "b" });
  const no = press(ask.state, data(), "up");
  assert.equal(no.state.list.confirm, undefined);
  assert.equal(no.action.kind, "none");
});

test("list: Esc goes back to /agents, r checks memory again", () => {
  assert.deepEqual(press(openMeasure(), data(), "back"), { state: closedMeasure, action: { kind: "close" } });
  assert.deepEqual(press(openMeasure(), data(), "refresh").action, { kind: "refresh" });
});

test("list: loading and an error", () => {
  assert.ok(text(openMeasure(), data({ plan: null, list: null })).some((l) => l.includes("asking the daemon")));
  assert.ok(text(openMeasure(), data({ error: "Could not reach golem." })).some((l) => l.includes("Could not reach golem.")));
});

test("run, running: progress bar, the ask, memory, the last runs; x stops; Esc leaves it running", () => {
  const d = data({ measurement: RUNNING, live: LIVE, list: [RUNNING_ROW] });
  const out = text(withRun(), d);
  assert.match(out[0]!, /^Agents › Measure › Today 14:02 · run 6 of 10 +esc back$/);
  assert.ok(out.some((l) => /[█░]+\s+12:40 gone · about 13 min left/.test(l)));
  assert.ok(out.some((l) => l.includes("helpers on · Read the whole repo · Local 32K")));
  assert.ok(out.some((l) => l.includes("mem 33 of 36 GB")));
  assert.ok(out.some((l) => l.startsWith("✓ ")));
  assert.ok(out.some((l) => l.startsWith("● ") && l.includes("running")));
  assert.ok(out.at(-1)!.includes("x stop · a the runs · Esc back to the list (the run goes on)"));
  assert.deepEqual(press(withRun(), d, "stop").action, { kind: "stop", id: "m1" });
  const back = press(withRun(), d, "back");
  assert.equal(back.state.run, null);
  assert.deepEqual(back.action, { kind: "refresh" });
});

test("run, running: delete is refused, and a busy stop waits", () => {
  const d = data({ measurement: RUNNING, live: LIVE });
  assert.match(press(withRun(), d, "delete").state.run?.notice ?? "", /Stop it first/);
  assert.equal(press(withRun(), { ...d, busy: true }, "stop").action.kind, "none");
});

test("run, stopped: the reason, what is kept, run the rest, delete", () => {
  const d = data({ measurement: STOPPED });
  const out = text(withRun(), d);
  assert.match(out[0]!, /Agents › Measure › .* · stopped +esc back$/);
  assert.ok(out.some((l) => l.includes("Stopped after 3 of 10 runs.")));
  assert.ok(out.some((l) => l.includes("Ollama stopped answering. 3 runs are kept. 7 were not run")));
  assert.ok(out.at(-1)!.includes("enter run the other 7 · t the box · a the runs · d delete · Esc back"));
  // local-32k is tight in the plan: the rest needs the box, and it is never off for memory.
  assert.ok(out.some((l) => l.includes("I saved my work. Run although memory is tight.")));
  const early = press(withRun(), d, "enter");
  assert.equal(early.action.kind, "none");
  assert.match(early.state.run?.notice ?? "", /Press t/);
  const ticked = press(withRun(), d, "saved");
  assert.equal(ticked.state.list.saved, true);
  assert.deepEqual(press(ticked.state, d, "enter").action, { kind: "resume", id: "m1", allowTight: true, ownRisk: false });
  const fits = data({ measurement: STOPPED, plan: { arms: [{ ...ARMS[0]!, verdict: "fits" }] } });
  assert.deepEqual(press(withRun(), fits, "enter").action, { kind: "resume", id: "m1", allowTight: false, ownRisk: false });
  const risky = data({ measurement: STOPPED, plan: { arms: NO_ROOM } });
  assert.ok(text(withRun(), risky).some((l) => l.includes("Run at my own risk")));
  assert.deepEqual(press(withRun(), risky, "saved", "enter").action, { kind: "resume", id: "m1", allowTight: true, ownRisk: true });
  const ask = press(withRun(), d, "delete");
  assert.equal(ask.state.run?.confirm, true);
  assert.ok(text(ask.state, d).at(-1)!.includes("Delete this measurement?"));
  assert.deepEqual(press(ask.state, d, "yes").action, { kind: "delete", id: "m1" });
  assert.equal(press(ask.state, d, "enter").action.kind, "none");
});

test("run, done: the verdict, the four numbers, use these numbers", () => {
  const d = data({ measurement: DONE });
  const out = text(withRun(), d);
  assert.match(out[0]!, /Agents › Measure › .* · done in 34:10 +esc back$/);
  assert.ok(out.some((l) => l.includes("Done in 34:10.")));
  assert.ok(out.some((l) => /read_share\s+30% → 42%/.test(l)));
  assert.ok(out.some((l) => /fill_share\s+85% → 80%/.test(l)));
  assert.ok(out.some((l) => /job_share\s+not measured/.test(l)));
  assert.ok(out.some((l) => /price_ratio\s+not measured/.test(l)));
  assert.ok(out.at(-1)!.includes("enter use these numbers · v the table · a the runs · d delete · Esc back (keeps yours)"));
  assert.deepEqual(press(withRun(), d, "enter").action, { kind: "apply", id: "m1" });
  // Esc keeps the numbers the user has.
  assert.deepEqual(press(withRun(), d, "back").action, { kind: "refresh" });
});

test("run, done: v shows the table with a verdict per ask and scrolls", () => {
  const d = data({ measurement: DONE });
  const shown = press(withRun(), d, "table");
  assert.equal(shown.state.run?.table, true);
  const out = text(shown.state, d);
  assert.ok(out.some((l) => /Local 32K/.test(l)));
  assert.ok(out.some((l) => /Read the whole repo\s+0\.80 → 0\.90.*helper wins/.test(l)));
  assert.ok(out.some((l) => /Summarise one file.*no helper/.test(l)));
  assert.ok(out.at(-1)!.includes("v the numbers"));
  const short = text(shown.state, d, 100, 8);
  assert.equal(short.length, 8);
  assert.notDeepEqual(text(press(shown.state, d, "page-down").state, d, 100, 8), short);
  assert.equal(press(shown.state, d, "table").state.run?.table, false);
});

test("run, done: numbers already in use cannot be used again", () => {
  const d = data({ measurement: { ...DONE, in_use: true } });
  const out = press(withRun(), d, "enter");
  assert.equal(out.action.kind, "none");
  assert.match(out.state.run?.notice ?? "", /in use/);
  assert.ok(!text(withRun(), d).at(-1)!.includes("use these numbers"));
});

test("run, done with too little data: nothing to use", () => {
  const d = data({ measurement: { ...DONE, proposal: null } });
  assert.equal(press(withRun(), d, "enter").action.kind, "none");
});

test("run: not read yet, and a way back at every state", () => {
  const d = data();
  assert.ok(text(withRun(), d).some((l) => l.includes("reading the measurement")));
  assert.match(press(withRun(), d, "enter").state.run?.notice ?? "", /Not read yet/);
  assert.deepEqual(press(withRun(), d, "refresh").action, { kind: "open", id: "m1" });
  for (const measurement of [null, RUNNING, STOPPED, DONE]) {
    assert.equal(press(withRun(), data({ measurement }), "back").state.run, null);
    const out = text(withRun(), data({ measurement }));
    assert.ok(out[0]!.endsWith("esc back"));
    assert.ok(out.at(-1)!.includes("Esc back"));
  }
});

test("a measurement of another id is not shown", () => {
  assert.ok(text(withRun("other"), data({ measurement: DONE })).some((l) => l.includes("reading the measurement")));
});

test("state helpers", () => {
  assert.deepEqual(measureOpened(openMeasure(), "x").run, { id: "x" });
  assert.equal(measureListed(withRun()).run, null);
  assert.equal(measureNoticed(withRun(), "hi").run?.notice, "hi");
  assert.equal(measureNoticed(openMeasure(), "hi").list.notice, "hi");
});

test("layout fits the screen: no line wider than the columns, no more rows than given", () => {
  for (const [state, d] of [
    [openMeasure(), data()],
    [withRun(), data({ measurement: RUNNING, live: LIVE })],
    [withRun(), data({ measurement: STOPPED })],
    [withRun(), data({ measurement: DONE })],
  ] as const) {
    const out = layoutMeasure({ state, data: d, columns: 50, rows: 12, now: NOW });
    assert.ok(out.length <= 12);
    for (const line of out) assert.ok((line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0) + line.text.length <= 50, line.text);
  }
});

const ASK: EvalAsk = { name: "Read the whole repo", text: "list the modules that define handle_ functions", facts: ["orbit", "ember"], setup: "24 modules of 60 lines", reason: "window", why: "The reading is large." };
const DETAILED: EvalMeasurement = {
  ...DONE,
  asks: [ASK],
  own_risk: true,
  golem_version: "0.9.1",
  arm_params: [{ name: "local-32k", model: "ollama/qwen3.8:27b", window: 32768, at_a_time: 1, helper_model: "the same model as the lead" }],
  runs: DONE.runs.map((run) => (run.ask === ASK.name && run.mode === "off" ? { ...run, answer: "It is orbit.", found: ["orbit"], missing: ["ember"] } : run)),
};

test("list: a shows the asks with their message and what the answer must mention, and Esc goes back", () => {
  const d = data({ plan: { arms: ARMS, asks: [ASK] } });
  const shown = press(openMeasure(), d, "asks");
  assert.equal(shown.state.list.asks, true);
  const out = text(shown.state, d);
  assert.ok(out.some((l) => l.includes('"list the modules that define handle_ functions"')));
  assert.ok(out.some((l) => l.includes("The answer must mention: orbit; ember")));
  assert.ok(out.some((l) => l.includes("24 modules of 60 lines")));
  assert.equal(press(shown.state, d, "back").state.list.asks, undefined);
  assert.match(press(openMeasure(), data(), "asks").state.list.notice ?? "", /not read yet/);
});

test("run: a lists every run, o opens the one under the cursor with its message, facts and answer", () => {
  const d = data({ measurement: DETAILED });
  const listed = press(withRun(), d, "asks");
  assert.equal(listed.state.run?.runs, true);
  const out = text(listed.state, d, 100, 40);
  assert.ok(out.some((l) => l.includes("window 32,768 tokens · one request at a time")));
  assert.ok(out.some((l) => l.includes("started at your own risk")));
  assert.ok(out.some((l) => l.includes("share of the expected facts")));
  const find = press(listed.state, d, "down", "down", "down", "down", "open");
  const open = text(find.state, d, 100, 60);
  assert.ok(open.some((l) => l.includes("The message:")));
  assert.ok(open.some((l) => /✓ +orbit/.test(l)) || open.some((l) => l.includes("✓ orbit")) || open.some((l) => l.includes("orbit")));
  assert.ok(open.some((l) => l.includes("It is orbit.")));
  assert.ok(open.some((l) => l.includes("✗") && l.includes("ember")));
  assert.equal(press(find.state, d, "open").state.run?.open, undefined);
  assert.equal(press(listed.state, d, "back").state.run?.runs, undefined);
  assert.equal(press(listed.state, d, "back").state.run?.id, "m1");
});
