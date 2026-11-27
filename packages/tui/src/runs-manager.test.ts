import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunInfo } from "@golem/client";
import { runDuration, runGroupHeading, runGroups, runResultLine, runRowLine } from "@golem/view";

import type { Press } from "./keys.ts";

import {
  closedRunsManager,
  layoutRunsManager,
  openRunsManager,
  orderedRuns,
  pressRunsManager,
  runMark,
  runsManagerKeyOf,
  type RunList,
  type RunsManagerKey,
  type RunsManagerState,
} from "./runs-manager.ts";

const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime();
const at = (hour: number, minute = 0, day = 18): string => new Date(2026, 10, day, hour, minute, 0).toISOString();

function info(session: string, status: RunInfo["status"], extra: Partial<RunInfo> = {}): RunInfo {
  return {
    session_id: session,
    kind: "routine",
    origin: "routine",
    routine: session,
    folder: null,
    routine_run_id: `rr-${session}`,
    trigger: "schedule",
    status,
    started_at: at(8, 30),
    ended_at: at(8, 32),
    summary: null,
    reason: null,
    approvals: 0,
    watch_path: null,
    steps: null,
    ...extra,
  } as RunInfo;
}

const triage = info("sentry-triage", "waiting", {
  started_at: at(11, 0),
  ended_at: null,
  approvals: 1,
  summary: "Allow gh issue create",
});
const live = info("receipts", "running", { started_at: at(11, 59), ended_at: null, trigger: "watch", watch_path: "/d/receipt-0412.pdf" });
const brief = info("morning-brief", "succeeded", { summary: "5 PRs, 3 Linear issues" });
const bad = info("release-check", "failed", { started_at: at(7, 5), ended_at: at(7, 6), reason: "step lint exited 1" });
const old = info("dep-report", "skipped", { started_at: at(9, 0, 10), ended_at: null, reason: "paused" });
const RUNS = [old, brief, live, bad, triage];
const LIST: RunList = { runs: RUNS, error: null };

const wfRun = info("wf-7f3a", "waiting", { kind: "workflow", origin: "workflow:pr-digest", workflow_run_id: "wr_7f3a", routine: null, steps: 4 });
const wfDone = info("wf-done", "succeeded", { kind: "routine", origin: "workflow:pr-digest", workflow_run_id: "wr_done" });

test("Enter on a workflow run opens its steps, also when a routine started it; any other run opens its chat", () => {
  const state = openRunsManager();
  const runs = [wfRun, wfDone, brief];
  assert.deepEqual(pressRunsManager(state, runs, "enter", NOW).action, { kind: "open-workflow", workflowRunId: "wr_7f3a" });
  const second = pressRunsManager({ ...state, selected: 1 }, runs, "enter", NOW);
  assert.equal(orderedRuns(runs, NOW)[1]?.session_id, second.action.kind === "open-workflow" ? "wf-done" : "x");
  assert.deepEqual(pressRunsManager({ ...state, selected: 2 }, runs, "enter", NOW).action, { kind: "open", sessionId: "morning-brief" });
});

test("a workflow run with no session opens by its run id, and a row with no id opens nothing", () => {
  const bare = { ...wfRun } as Partial<RunInfo> & Pick<RunInfo, "kind" | "origin" | "status">;
  delete bare.session_id;
  const state = openRunsManager();
  assert.deepEqual(pressRunsManager(state, [bare as RunInfo], "enter", NOW).action, { kind: "open-workflow", workflowRunId: "wr_7f3a" });
  const nothing = { ...bare, workflow_run_id: null } as RunInfo;
  assert.deepEqual(pressRunsManager(state, [nothing], "enter", NOW).action, { kind: "none" });
});

test("c cancels a workflow run that has not ended, and does nothing for another row", () => {
  const runs = [wfRun, wfDone, brief, live];
  assert.deepEqual(pressRunsManager(openRunsManager(), runs, "cancel", NOW).action, { kind: "cancel", workflowRunId: "wr_7f3a" });
  const ended = orderedRuns(runs, NOW).findIndex((run) => run.session_id === "wf-done");
  assert.deepEqual(pressRunsManager({ open: true, selected: ended }, runs, "cancel", NOW).action, { kind: "none" });
  const routine = orderedRuns(runs, NOW).findIndex((run) => run.session_id === "receipts");
  assert.deepEqual(pressRunsManager({ open: true, selected: routine }, runs, "cancel", NOW).action, { kind: "none" });
});

test("the hint offers c only while a cancellable workflow run is selected", () => {
  const lines = (runs: RunInfo[], selected: number) => layoutRunsManager({ state: { open: true, selected }, list: { runs, error: null }, now: NOW, columns: 100, rows: 24 });
  assert.equal(lines([wfRun, brief], 0).at(-1)?.text, "↑/↓ to navigate · Enter to open · c cancel the run · Esc to close");
  assert.equal(lines([wfRun, brief], 1).at(-1)?.text, "↑/↓ to navigate · Enter to open · Esc to close");
});

test("the c key", () => {
  assert.equal(runsManagerKeyOf({ name: null, input: "c", ctrl: false, meta: false }), "cancel");
});

function press(state: RunsManagerState, ...keys: RunsManagerKey[]) {
  let current = state;
  let action: ReturnType<typeof pressRunsManager>["action"] = { kind: "none" };
  for (const key of keys) {
    ({ state: current, action } = pressRunsManager(current, RUNS, key, NOW));
  }
  return { state: current, action };
}

function shown(state: RunsManagerState, list: RunList = LIST, rows = 40): string[] {
  return layoutRunsManager({ state, list, now: NOW, columns: 140, rows }).map(
    (line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`,
  );
}

test("keys: arrows, Enter and Esc", () => {
  const key = (name: Press["name"], input = "") => runsManagerKeyOf({ name, input, ctrl: false, meta: false });
  assert.equal(key("up"), "up");
  assert.equal(key("down"), "down");
  assert.equal(key("return"), "enter");
  assert.equal(key("escape"), "back");
  assert.equal(key(null, "x"), null);
});

test("marks: ! needs you, ● running, ✔ finished, ✘ failed, ○ skipped", () => {
  assert.deepEqual(runMark(triage), { text: "!", tone: "wait" });
  assert.deepEqual(runMark(live), { text: "●", tone: "ok" });
  assert.deepEqual(runMark(brief), { text: "✔", tone: "ok" });
  assert.deepEqual(runMark(bad), { text: "✘", tone: "bad" });
  assert.deepEqual(runMark(old), { text: "○", tone: "off" });
  assert.deepEqual(runMark(info("c", "cancelled")), { text: "○", tone: "off" });
});

test("the groups are the web's: Needs you, Running, Today, Earlier", () => {
  assert.deepEqual(
    orderedRuns(RUNS, NOW).map((run) => run.session_id),
    ["sentry-triage", "receipts", "morning-brief", "release-check", "dep-report"],
  );
  const lines = shown(openRunsManager());
  const groups = runGroups(RUNS, NOW);
  assert.deepEqual(
    lines.filter((line) => line.startsWith("  ") && /\(\d+\)$/.test(line)).map((line) => line.trim()),
    groups.map(runGroupHeading),
  );
  assert.deepEqual(lines.slice(0, 2), ["Runs", "1 needs you · 1 running · 2 today · 1 earlier"]);
  assert.equal(lines.at(-1), "↑/↓ to navigate · Enter to open · Esc to close");
});

test("a waiting routine run shows its question and a ! mark, with the pointer on it first", () => {
  const lines = shown(openRunsManager());
  const row = lines.find((line) => line.includes("sentry-triage"));
  assert.ok(row?.startsWith("❯ ! sentry-triage"));
  assert.ok(row?.includes(runRowLine(triage, NOW)));
  assert.ok(row?.includes(runDuration(triage, NOW)));
  assert.ok(row?.endsWith("Allow gh issue create"));
  assert.equal(runResultLine(triage), "Allow gh issue create");
  const failed = lines.find((line) => line.includes("release-check"));
  assert.ok(failed?.startsWith("  ✘ release-check"));
  assert.ok(failed?.endsWith("step lint exited 1"));
});

test("the pointer follows the arrows across groups and stops at the ends", () => {
  assert.equal(press(openRunsManager(), "down", "down").state.selected, 2);
  assert.equal(press(openRunsManager(), "up").state.selected, 0);
  assert.equal(press(openRunsManager(), ...Array<RunsManagerKey>(20).fill("down")).state.selected, 4);
});

test("Enter opens the run's session, and Esc closes", () => {
  assert.deepEqual(press(openRunsManager(), "enter").action, { kind: "open", sessionId: "sentry-triage" });
  assert.deepEqual(press(openRunsManager(), "down", "down", "down", "enter").action, {
    kind: "open",
    sessionId: "release-check",
  });
  const closed = press(openRunsManager(), "back");
  assert.deepEqual(closed.state, closedRunsManager);
  assert.deepEqual(closed.action, { kind: "close" });
  assert.deepEqual(pressRunsManager(openRunsManager(), [], "enter", NOW).action, { kind: "none" });
});

test("no runs, an error, and a wait", () => {
  assert.deepEqual(shown(openRunsManager(), { runs: [], error: null }).slice(0, 4), [
    "Runs",
    "no runs",
    "",
    "Nothing has run yet. Routines and golem ask --detach show up here.",
  ]);
  assert.deepEqual(shown(openRunsManager(), { runs: null, error: "daemon is down" }).slice(0, 3), ["Runs", "", "daemon is down"]);
  assert.equal(shown(openRunsManager(), { runs: null, error: null })[2], "asking the daemon…");
});

test("a long list scrolls to keep the pointer on screen, and a line is cut to the width", () => {
  const many = Array.from({ length: 30 }, (_, index) => info(`r${String(index).padStart(2, "0")}`, "succeeded", { started_at: at(8, index) }));
  const state: RunsManagerState = { open: true, selected: 25 };
  const lines = layoutRunsManager({ state, list: { runs: many, error: null }, now: NOW, columns: 30, rows: 10 });
  assert.equal(lines.length, 10);
  assert.ok(lines.some((line) => line.selected === true));
  for (const line of lines) {
    assert.ok((line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0) + line.text.length <= 30);
  }
});
