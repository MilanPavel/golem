import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvalMeasurement, EvalPlanArm, EvalRun, EvalSummary } from "@golem/client";

import { armLabel, armRow, armRows, canUseNumbers, doneFooter, doneLine, foldEval, foldLive, measureList, noRoomLine, progressView, proposalLines, resultTables, runRows, startPlan, stoppedView, whenText } from "./measure.ts";

const local = (over: Partial<EvalPlanArm>): EvalPlanArm => ({ name: "local-32k", label: "Local, 32K window", kind: "local", tier: "local", model: "ollama/qwen3.8:27b", window: 32768, asks: 10, minutes: 35, verdict: "fits", needed_gb: 21.1, ram_gb: 36, free_gb: 24.3, ...over });
const cloud = (over: Partial<EvalPlanArm>): EvalPlanArm => ({ name: "budget", label: "Budget cloud", kind: "cloud", tier: "budget", model: "claude-haiku", window: 32768, asks: 10, minutes: 5, cost_usd: 0.4, ...over });

test("a local arm says what it needs, and a tight one asks for the box", () => {
  const fits = armRow(local({}));
  assert.equal(fits.memoryLine, "needs 21.1 GB of 36 GB, 24.3 GB free");
  assert.deepEqual(fits.tag, { text: "FITS", tone: "ok" });
  assert.ok(fits.canTick && !fits.needsSaved);
  assert.ok(fits.bar !== null && Math.abs(fits.bar.other - 11.7 / 36) < 1e-9);
  const tight = armRow(local({ verdict: "tight", reason: "Takes over half." }));
  assert.ok(tight.canTick && tight.needsSaved);
  assert.equal(tight.reason, "Takes over half.");
  assert.equal(tight.tag.text, "TIGHT");
});

test("too big, no room and unknown cannot be ticked", () => {
  for (const verdict of ["too_big", "no_room", "unknown"] as const) {
    const row = armRow(local({ verdict, reason: undefined }));
    assert.equal(row.canTick, false, verdict);
    assert.ok(row.reason.length > 0, verdict);
  }
  assert.equal(armRow(local({ verdict: "too_big" })).tag.text, "TOO BIG");
  assert.equal(armRow(local({ verdict: "no_room" })).tag.text, "NO ROOM NOW");
  const blind = armRow(local({ verdict: null, needed_gb: null, free_gb: null }));
  assert.equal(blind.memoryLine, "memory could not be read");
  assert.equal(blind.canTick, false);
  assert.equal(blind.bar, null);
});

test("a paid arm shows its cost and has no memory bar", () => {
  const row = armRow(cloud({}));
  assert.equal(row.memoryLine, "no memory, about $0.40");
  assert.equal(row.tag.text, "PAID");
  assert.equal(row.bar, null);
  assert.equal(armRow(cloud({ cost_usd: 6 })).memoryLine, "no memory, about $6");
  assert.equal(armRow(cloud({ cost_usd: null })).memoryLine, "no memory, cost not known");
});

test("no local arm can run now", () => {
  assert.ok(noRoomLine(armRows([local({ verdict: "no_room" }), local({ name: "b", verdict: "too_big" }), cloud({})])) !== null);
  assert.equal(noRoomLine(armRows([local({}), local({ name: "b", verdict: "too_big" })])), null);
  assert.equal(noRoomLine(armRows([cloud({})])), null);
});

test("Start is off while one runs, with nothing chosen, or before the box is ticked", () => {
  const rows = armRows([local({ verdict: "tight" }), local({ name: "big", verdict: "too_big" }), cloud({})]);
  const none = startPlan(rows, new Set(), false, false);
  assert.equal(none.canStart, false);
  assert.equal(none.line, "Nothing chosen yet");
  const running = startPlan(rows, new Set(["local-32k"]), true, true);
  assert.equal(running.canStart, false);
  assert.equal(running.line, "Wait for the running one, or stop it");
  const unsaved = startPlan(rows, new Set(["local-32k"]), false, false);
  assert.equal(unsaved.canStart, false);
  assert.ok(unsaved.needsSaved);
  assert.equal(unsaved.line, "Tick the box on the left to go on");
  const bad = startPlan(rows, new Set(["big"]), true, false);
  assert.equal(bad.canStart, false);
});

test("a tight arm starts with allow_tight once the box is ticked; a paid arm alone needs no box", () => {
  const rows = armRows([local({ verdict: "tight" }), cloud({})]);
  const tight = startPlan(rows, new Set(["local-32k"]), true, false);
  assert.ok(tight.canStart);
  assert.equal(tight.allowTight, true);
  assert.deepEqual(tight.arms, ["local-32k"]);
  assert.equal(tight.line, "20 runs · about 35 min · $0 · one model, one request at a time");
  const paid = startPlan(rows, new Set(["budget"]), false, false);
  assert.ok(paid.canStart);
  assert.equal(paid.allowTight, false);
  assert.equal(paid.line, "20 runs · about 5 min · about $0.40");
  const fits = startPlan(armRows([local({})]), new Set(["local-32k"]), true, false);
  assert.equal(fits.allowTight, false);
});

test("labels and dates", () => {
  assert.equal(armLabel("local-32k"), "Local 32K");
  assert.equal(armLabel("budget-cloud"), "Budget cloud");
  const now = new Date(2026, 10, 24, 16, 0);
  assert.equal(whenText(new Date(2026, 10, 24, 14, 2).toISOString(), now), "Today 14:02");
  assert.equal(whenText(new Date(2026, 10, 21, 9, 0).toISOString(), now), "21 Nov");
  assert.equal(whenText("nonsense", now), "");
});

const summary = (over: Partial<EvalSummary>): EvalSummary => ({ id: "a", arms: [{ name: "local-32k", model: "qwen3.8:27b" }], runs_played: 20, runs_total: 20, started_at: new Date(2026, 10, 21, 9, 0).toISOString(), state: "done", ...over });

test("the list puts the running one first and describes each", () => {
  const now = new Date(2026, 10, 24, 16, 0);
  const rows = measureList(
    [
      summary({ id: "d", state: "done", proposes: 2 }),
      summary({ id: "r", state: "running", runs_played: 6 }),
      summary({ id: "s", state: "stopped", runs_played: 3, stop_reason: "You stopped it." }),
      summary({ id: "b", state: "done", in_use: true, cost_usd: 0.38 }),
    ],
    now,
  );
  assert.deepEqual(rows.map((row) => row.id), ["r", "d", "s", "b"]);
  assert.equal(rows[0]?.note, "run 7 of 20");
  assert.equal(rows[0]?.status.text, "Running");
  assert.equal(rows[0]?.arms, "Local 32K · qwen3.8:27b");
  assert.equal(rows[1]?.note, "20 runs · proposes 2 numbers");
  assert.equal(rows[2]?.note, "You stopped it. · 3 of 20 runs kept");
  assert.equal(rows[3]?.note, "20 runs · $0.38 · its numbers are in use");
});

const run = (over: Partial<EvalRun>): EvalRun => ({ arm: "local-32k", ask: "Read the repo", mode: "off", end: "completed", quality: 0.8, seconds: 72, window_left: 0.4, helpers_started: 0, ...over });
const base = (runs: EvalRun[], over: Partial<EvalMeasurement> = {}): EvalMeasurement => ({ id: "m", arms: [{ name: "local-32k", model: "qwen3.8:27b" }], runs, started_at: "2026-11-24T14:00:00Z", state: "running", ...over });

test("run rows: done, running, pending, not run, failed", () => {
  const rows = runRows(base([run({}), run({ mode: "on", end: "running", quality: null, seconds: null, window_left: null }), run({ ask: "b", end: "pending", quality: null }), run({ ask: "c", end: "not_run" }), run({ ask: "d", end: "timeout", quality: null })]));
  assert.deepEqual(rows.map((row) => row.state), ["done", "running", "pending", "not_run", "failed"]);
  assert.deepEqual([rows[0]?.answer, rows[0]?.time, rows[0]?.windowLeft, rows[0]?.started], ["0.80", "1:12", "40%", "–"]);
  assert.equal(rows[1]?.word, "running");
  assert.equal(rows[3]?.word, "not run");
  assert.equal(rows[4]?.word, "took too long");
});

test("the reducer: started, progress, ended", () => {
  const started = foldEval(null, { kind: "started", started: { id: "m", arms: [{ name: "local-32k", model: "q" }], started_at: "t", total: 2 } });
  assert.equal(started?.state, "running");
  assert.deepEqual(started?.runs, []);
  const progress = (state: "running" | "completed", ask = "A", id = "m") => ({ kind: "progress" as const, progress: { id, arm: "local-32k", mode: "off" as const, ask, index: 1, total: 2, elapsed: 3, state } });
  const one = foldEval(started, progress("running"));
  assert.deepEqual(one?.runs, [{ arm: "local-32k", ask: "A", mode: "off", end: "running" }]);
  const two = foldEval(one, progress("completed"));
  assert.equal(two?.runs[0]?.end, "completed");
  assert.equal(two?.runs.length, 1);
  assert.equal(foldEval(two, progress("running", "A", "other")), two);
  const withPending = foldEval(two, progress("running", "B"));
  const ended = foldEval(withPending && { ...withPending, runs: [...withPending.runs, run({ ask: "C", end: "pending" })] }, { kind: "ended", ended: { id: "m", state: "stopped", stop_reason: "Ollama stopped answering." } });
  assert.equal(ended?.state, "stopped");
  assert.equal(ended?.stop_reason, "Ollama stopped answering.");
  assert.deepEqual(ended?.runs.map((r) => r.end), ["completed", "not_run", "not_run"]);
  assert.equal(foldEval(ended, { kind: "ended", ended: { id: "x", state: "done" } }), ended);
  assert.equal(foldEval(null, { kind: "ended", ended: { id: "m", state: "done" } }), null);
});

test("the reducer: a resumed measurement plays the rest again", () => {
  const stopped = base([run({}), run({ ask: "B", end: "not_run" })], { state: "stopped", stop_reason: "x" });
  const again = foldEval(stopped, { kind: "started", started: { id: "m", arms: stopped.arms, started_at: stopped.started_at, total: 2 } });
  assert.equal(again?.state, "running");
  assert.equal(again?.stop_reason, null);
  assert.deepEqual(again?.runs.map((r) => r.end), ["completed", "pending"]);
});

test("the live reading keeps the last memory until a new one comes, and ends with the run", () => {
  const p = (memory: number | null) => ({ kind: "progress" as const, progress: { id: "m", arm: "a", mode: "on" as const, ask: "A", index: 2, total: 20, elapsed: 90, state: "running" as const, memory_used_gb: memory, memory_total_gb: memory === null ? null : 36 } });
  const first = foldLive(null, p(33));
  assert.equal(first?.memoryUsedGb, 33);
  const second = foldLive(first, p(null));
  assert.equal(second?.memoryUsedGb, 33);
  assert.equal(foldLive(second, { kind: "ended", ended: { id: "m", state: "done" } }), null);
  assert.equal(foldLive(second, { kind: "ended", ended: { id: "z", state: "done" } }), second);
});

test("the progress line: which run, how far, how long, memory", () => {
  const runs = [...Array.from({ length: 6 }, (_, i) => run({ ask: `A${i}` })), run({ ask: "Big", mode: "on", end: "running", quality: null }), ...Array.from({ length: 13 }, (_, i) => run({ ask: `P${i}`, end: "pending" }))];
  const live = foldLive(null, { kind: "progress", progress: { id: "m", arm: "local-32k", mode: "on", ask: "Big", index: 7, total: 20, elapsed: 760, state: "running", memory_used_gb: 33, memory_total_gb: 36 } });
  const view = progressView(base(runs), live);
  assert.equal(view.title, "Run 7 of 20");
  assert.equal(view.what, "helpers on · Big · Local 32K");
  assert.equal(view.time, "12:40 gone · about 30 min left");
  assert.equal(view.memory, "33 of 36 GB");
  assert.ok(Math.abs(view.share - 6.5 / 20) < 1e-9);
  assert.equal(progressView(base(runs), null).memory, null);
});

test("a stopped run says why, what is kept and what is left", () => {
  const stopped = base([run({}), run({ mode: "on" }), run({ ask: "B", end: "not_run" }), run({ ask: "C", end: "not_run" })], { state: "stopped", stop_reason: "Ollama stopped answering." });
  const view = stoppedView(stopped);
  assert.equal(view.title, "Stopped after 2 of 4 runs.");
  assert.equal(view.detail, "Ollama stopped answering. 2 runs are kept. 2 were not run and are not counted. There is not enough data for a proposal.");
  assert.equal(view.resume, "Run the other 2");
  assert.equal(stoppedView(base([run({})], { state: "stopped" })).resume, null);
});

const done = (over: Partial<EvalMeasurement> = {}): EvalMeasurement =>
  base(
    [
      run({ ask: "Large" }),
      run({ ask: "Large", mode: "on", quality: 0.9, seconds: 90, window_left: 0.6, helpers_started: 3 }),
      run({ ask: "Same" }),
      run({ ask: "Same", mode: "on", quality: 0.8, window_left: 0.45, helpers_started: 2 }),
      run({ ask: "Small" }),
      run({ ask: "Small", mode: "on", helpers_started: 0 }),
    ],
    {
      state: "done",
      ended_at: "2026-11-24T14:34:10Z",
      proposal: {
        pairs: 3,
        wins: 1,
        numbers: [
          { key: "price_ratio", current: 3, proposed: null, measured: false, note: "cloud arms only" },
          { key: "read_share", current: 0.3, proposed: 0.42, measured: true, note: "smallest reading where a helper won" },
          { key: "fill_share", current: 0.85, proposed: 0.85, measured: true },
          { key: "job_share", current: 0.1, proposed: null, measured: false },
        ],
      },
      ...over,
    },
  );

test("the result table sets off against on and judges each ask", () => {
  const tables = resultTables(done());
  assert.equal(tables.length, 1);
  const rows = tables[0]?.rows ?? [];
  assert.deepEqual(rows.map((row) => row.verdict.text), ["HELPER WINS", "SAME", "NO HELPER"]);
  assert.equal(rows[0]?.answer, "0.80 → 0.90");
  assert.equal(rows[0]?.time, "1:12 → 1:30");
  assert.equal(rows[0]?.windowLeft, "40% → 60%");
  assert.equal(rows[0]?.helpers, "3");
  assert.equal(rows[2]?.helpers, "–");
  assert.deepEqual(resultTables(base([run({})])), []);
});

test("the line over a finished table", () => {
  const line = doneLine(done());
  assert.equal(line.title, "Done in 34:10.");
  assert.equal(line.detail, "6 of 6 runs. Helpers gave a better answer or left clearly more window in 1 of 3 asks, and were never started for 1.");
  assert.equal(doneLine(done({ ended_at: null })).title, "Done.");
});

test("the proposal is four lines in a fixed order, and says what was not measured", () => {
  const lines = proposalLines(done());
  assert.deepEqual(lines.map((line) => line.key), ["read_share", "fill_share", "job_share", "price_ratio"]);
  assert.deepEqual([lines[0]?.current, lines[0]?.proposed, lines[0]?.changed], ["30%", "42%", true]);
  assert.equal(lines[1]?.changed, false);
  assert.deepEqual([lines[2]?.proposed, lines[2]?.note, lines[2]?.measured], [null, "", false]);
  assert.deepEqual([lines[3]?.current, lines[3]?.note], ["3×", "cloud arms only"]);
  assert.deepEqual(proposalLines(base([])), []);
});

test("Use these numbers is offered only for a done measurement with something to write", () => {
  assert.ok(canUseNumbers(done()));
  assert.equal(canUseNumbers(done({ in_use: true })), false);
  assert.equal(canUseNumbers(done({ state: "stopped" })), false);
  assert.equal(canUseNumbers(done({ proposal: null })), false);
  assert.equal(doneFooter(done({ in_use: true })), "These numbers are in use. See them on the Rules tab.");
  assert.equal(doneFooter(done()), "One run per ask. Measure again to see how much the numbers move.");
  assert.equal(doneFooter(done({ proposal: null })), "Too little ran to propose a number.");
});
