import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunInfo, WorkflowEntryInfo } from "@golem/client";

import type { Press } from "./keys.ts";
import {
  closedWorkflowsManager,
  failedWorkflowStart,
  layoutWorkflowsManager,
  openWorkflowsManager,
  orderedWorkflows,
  pressWorkflowsManager,
  workflowsManagerKeyOf,
  workflowsManagerTyping,
  type WorkflowDetailData,
  type WorkflowList,
  type WorkflowsKey,
  type WorkflowsManagerState,
} from "./workflows-manager.ts";

function entry(name: string, extra: Partial<WorkflowEntryInfo> = {}): WorkflowEntryInfo {
  return { id: `/w/${name}.py::${name}`, name, path: `/w/${name}.py`, state: "ok", project: "/repo", description: `${name} does things`, inputs: [], trigger: null, ...extra } as WorkflowEntryInfo;
}

const digest = entry("pr-digest", {
  inputs: [
    { name: "repo", type: "str" },
    { name: "days", type: "int", default: "7" },
    { name: "mode", type: 'Literal["fast", "slow"]', default: '"fast"' },
    { name: "dry", type: "bool", default: "False" },
  ],
});
const broken = entry("release-check", { state: "broken", error: "Traceback\n  File x\nImportError: no module named gh", description: "" });
const untrusted = entry("new-one", { state: "untrusted", description: "" });
const mine = entry("morning", { project: null });
const WORKFLOWS = [mine, digest, broken, untrusted];
const LIST: WorkflowList = { workflows: WORKFLOWS, error: null };

function press(state: WorkflowsManagerState, ...keys: WorkflowsKey[]) {
  let current = state;
  let action: ReturnType<typeof pressWorkflowsManager>["action"] = { kind: "none" };
  for (const key of keys) {
    const pressed = pressWorkflowsManager(current, WORKFLOWS, key);
    current = pressed.state;
    action = pressed.action;
  }
  return { state: current, action };
}

function text(value: string): WorkflowsKey {
  return { text: value };
}

const screen = (state: WorkflowsManagerState, rows = 24, list = LIST) => layoutWorkflowsManager({ state, list, columns: 100, rows }).map((line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`);

test("the list groups This project first, then Yours, with the broken error and the untrusted mark", () => {
  assert.deepEqual(orderedWorkflows(WORKFLOWS).map((workflow) => workflow.name), ["pr-digest", "release-check", "new-one", "morning"]);
  const lines = screen(openWorkflowsManager());
  assert.equal(lines[0], "Workflows");
  assert.equal(lines[1], "4 workflows · 1 broken · 1 not trusted");
  assert.ok(lines.includes("  This project"));
  assert.ok(lines.includes("  Yours"));
  assert.ok(lines.some((line) => line.startsWith("❯ ✔ pr-digest") && line.includes("pr-digest does things")));
  assert.ok(lines.some((line) => line.startsWith("  ✘ release-check") && line.endsWith("ImportError: no module named gh")));
  assert.ok(lines.some((line) => line.startsWith("  ! new-one") && line.endsWith("not trusted")));
  assert.equal(lines.at(-1), "↑/↓ to navigate · e edit · r run · Enter last run · h runs · Esc to close");
});

test("the list says when there are none, when it is loading, and why it failed", () => {
  assert.ok(screen(openWorkflowsManager(), 24, { workflows: [], error: null }).includes("no workflows"));
  assert.ok(screen(openWorkflowsManager(), 24, { workflows: null, error: null }).includes("asking the daemon…"));
  assert.ok(screen(openWorkflowsManager(), 24, { workflows: null, error: "no daemon" }).includes("no daemon"));
});

test("up and down move the pointer within the list, Esc closes", () => {
  const down = press(openWorkflowsManager(), "down", "down");
  assert.deepEqual(down.state.view, { kind: "list", selected: 2 });
  assert.deepEqual(press(openWorkflowsManager(), "up").state.view, { kind: "list", selected: 0 });
  assert.deepEqual(press(openWorkflowsManager(), "down", "down", "down", "down", "down").state.view, { kind: "list", selected: 3 });
  const closed = press(openWorkflowsManager(), "back");
  assert.deepEqual(closed.state, closedWorkflowsManager);
  assert.deepEqual(closed.action, { kind: "close" });
});

test("Enter opens the form with each field at its default, typed by its declared type", () => {
  const form = press(openWorkflowsManager(), "run").state.view;
  assert.equal(form.kind, "form");
  if (form.kind !== "form") return;
  assert.deepEqual(form.fields.map((field) => [field.name, field.kind, field.required]), [
    ["repo", "text", true],
    ["days", "number", false],
    ["mode", "choice", false],
    ["dry", "bool", false],
  ]);
  assert.deepEqual(form.values, { repo: "", days: "7", mode: "fast", dry: "false" });
  const lines = screen(openWorkflowsManager(), 24);
  assert.equal(lines[0], "Workflows");
  const formLines = screen(press(openWorkflowsManager(), "run").state);
  assert.equal(formLines[0], "Run pr-digest");
  assert.ok(formLines.some((line) => line.startsWith("❯ repo *") && line.includes("[▏]") && line.includes("str · required")));
  assert.ok(formLines.some((line) => line.includes("days") && line.includes("[7]") && line.includes("int · default 7")));
  assert.ok(formLines.some((line) => line.includes("mode") && line.includes("< fast >")));
  assert.ok(formLines.some((line) => line.includes("dry") && line.includes("[ ] no")));
});

test("the form edits text, deletes, clears, and moves between fields", () => {
  let state = press(openWorkflowsManager(), "run").state;
  state = press(state, text("my/repo"), "space", text("x")).state;
  assert.equal(state.view.kind === "form" ? state.view.values["repo"] : null, "my/repo x");
  state = press(state, "delete").state;
  assert.equal(state.view.kind === "form" ? state.view.values["repo"] : null, "my/repo ");
  state = press(state, "clear").state;
  assert.equal(state.view.kind === "form" ? state.view.values["repo"] : null, "");
  state = press(state, "down", "down").state;
  assert.equal(state.view.kind === "form" ? state.view.focus : null, 2);
  state = press(state, "tab", "tab", "tab").state;
  assert.equal(state.view.kind === "form" ? state.view.focus : null, 3);
  state = press(state, "shift-tab").state;
  assert.equal(state.view.kind === "form" ? state.view.focus : null, 2);
});

test("a choice cycles with the arrows and Space, a bool flips", () => {
  let state = press(openWorkflowsManager(), "run", "down", "down").state;
  state = press(state, "right").state;
  assert.equal(state.view.kind === "form" ? state.view.values["mode"] : null, "slow");
  state = press(state, "right").state;
  assert.equal(state.view.kind === "form" ? state.view.values["mode"] : null, "fast");
  state = press(state, "left").state;
  assert.equal(state.view.kind === "form" ? state.view.values["mode"] : null, "slow");
  state = press(state, "down", "space").state;
  assert.equal(state.view.kind === "form" ? state.view.values["dry"] : null, "true");
  assert.ok(screen(state).some((line) => line.includes("dry") && line.includes("[x] yes")));
});

test("Enter with a required field empty or a number that is not one stays, complains, and focuses the first", () => {
  let state = press(openWorkflowsManager(), "run", "down", "clear").state;
  state = press(state, text("abc")).state;
  const sent = press(state, "enter");
  assert.deepEqual(sent.action, { kind: "none" });
  assert.equal(sent.state.view.kind === "form" ? sent.state.view.focus : null, 0);
  const lines = screen(sent.state);
  assert.ok(lines.some((line) => line.includes("✘ Required.")));
  assert.ok(lines.some((line) => line.includes("✘ Enter a number.")));
});

test("Enter on a valid form starts the workflow with typed inputs, and the keys wait until it answers", () => {
  let state = press(openWorkflowsManager(), "run", text("golem")).state;
  state = press(state, "down", "clear", text("3")).state;
  const sent = press(state, "enter");
  assert.deepEqual(sent.action, {
    kind: "start",
    id: digest.id,
    name: "pr-digest",
    inputs: { repo: "golem", days: 3, mode: "fast", dry: false },
  });
  assert.equal(sent.state.view.kind === "form" ? sent.state.view.starting : null, true);
  assert.equal(screen(sent.state).at(-1), "Starting…");
  assert.deepEqual(press(sent.state, text("x"), "back").action, { kind: "none" });
  assert.equal(press(sent.state, "back").state.view.kind, "form");
  const failed = failedWorkflowStart(sent.state, "not trusted");
  assert.ok(screen(failed).some((line) => line.endsWith("✘ not trusted") || line.includes("not trusted")));
  assert.equal(failed.view.kind === "form" ? failed.view.starting : null, false);
});

test("a field with a default may be left empty, and the default then applies in the daemon", () => {
  const state = press(openWorkflowsManager(), "run", text("golem"), "down", "clear").state;
  const sent = press(state, "enter");
  assert.deepEqual(sent.action.kind === "start" ? sent.action.inputs : null, { repo: "golem", mode: "fast", dry: false });
});

test("Esc in the form goes back to the list", () => {
  const back = press(openWorkflowsManager(), "run", "back");
  assert.equal(back.state.view.kind, "list");
  assert.equal(back.state.open, true);
});

test("a broken workflow opens a form with its error as a warning, and a workflow without inputs says so", () => {
  const form = press(openWorkflowsManager(), "down", "run").state;
  assert.equal(form.view.kind, "form");
  const lines = screen(form);
  assert.equal(lines[0], "Run release-check");
  assert.ok(lines.includes("Starts one run now. This workflow takes no inputs."));
  assert.ok(lines.some((line) => line.startsWith("! ") && line.endsWith("ImportError: no module named gh")));
  const sent = press(form, "enter");
  assert.deepEqual(sent.action.kind === "start" ? sent.action.inputs : null, {});
});

const SEEN: WorkflowDetailData = {
  id: digest.id,
  steps: [
    { id: "s1", kind: "tool", title: "List pull requests", lines: [10, 12], key: "list", after: [] },
    { id: "s2", kind: "agent", title: "Write a note", agent: "writer", for_each: "prs", condition: "prs", lines: [14, 20], key: "note", after: [] },
    { id: "s3", kind: "review", title: "Look it over", lines: [22, 23], after: [] },
  ],
  lastRun: {
    run: { workflow_run_id: "wr1", name: "pr-digest", workflow_id: digest.id, status: "done", trigger: "manual", started_at: "2026-11-26T08:30:00" },
    steps: [
      { key: "list", kind: "tool", title: "List", status: "done", started_at: "2026-11-26T08:30:00", cost_usd: 0.01 },
      { key: "note", kind: "agent", title: "Note", status: "done", started_at: "2026-11-26T08:31:00", cost_usd: 0.03 },
    ],
  },
  error: null,
} as WorkflowDetailData;
const NOW = new Date("2026-11-26T12:00:00").getTime();
const RUNS = [
  { kind: "workflow", origin: "workflow:pr-digest", workflow_run_id: "wr2", session_id: "s", status: "running", started_at: "2026-11-26T11:00:00" },
  { kind: "workflow", origin: "workflow:pr-digest", workflow_run_id: "wr1", session_id: "s", status: "succeeded", started_at: "2026-11-26T08:30:00" },
  { kind: "workflow", origin: "workflow:other", workflow_run_id: "wr9", session_id: "s", status: "succeeded", started_at: "2026-11-26T07:00:00" },
] as unknown as RunInfo[];

const outline = (state: WorkflowsManagerState, detail: WorkflowDetailData | null = SEEN, rows = 40) =>
  layoutWorkflowsManager({ state, list: LIST, columns: 120, rows, detail, runs: RUNS, now: NOW }).map((line) => `${line.prefix ?? ""}${line.mark ? `${line.mark.text} ` : ""}${line.text}`);

test("the selected workflow shows its outline below the list, with last-run times and the header", () => {
  const lines = outline(openWorkflowsManager());
  const at = lines.indexOf("pr-digest");
  assert.ok(at > 0);
  assert.equal(lines[at + 1], "last run 08:30 · done · $0.04");
  assert.equal(lines[at + 2], "1  08:30  List pull requests  tool");
  assert.equal(lines[at + 3], "2  08:31  Write a note  agent · agent writer · for each prs · if prs");
  assert.equal(lines[at + 4], "3         Look it over  review");
  assert.ok(outline(openWorkflowsManager(), null).includes("reading the file…"));
  assert.ok(outline(openWorkflowsManager(), { ...SEEN, steps: [], lastRun: null }).includes("No steps found in the file."));
  assert.ok(outline(openWorkflowsManager(), { ...SEEN, error: "boom" }).includes("✘ boom"));
});

test("a broken workflow shows its traceback instead of the outline", () => {
  const lines = outline(press(openWorkflowsManager(), "down").state);
  const at = lines.indexOf("release-check");
  assert.ok(at > 0);
  assert.deepEqual(lines.slice(at + 1, at + 4), ["Traceback", "  File x", "✘ ImportError: no module named gh"]);
  assert.ok(!lines.some((line) => line.includes("List pull requests")));
});

test("an untrusted workflow says trust first and has no key that runs", () => {
  const state = press(openWorkflowsManager(), "down", "down").state;
  assert.ok(outline(state).some((line) => line.startsWith("! Not trusted: add this project to trusted_projects")));
  assert.equal(outline(state).at(-1), "↑/↓ to navigate · e edit · Esc to close");
  for (const key of ["run", "enter", "history"] as const) {
    const pressed = pressWorkflowsManager(state, WORKFLOWS, key, RUNS);
    assert.deepEqual(pressed.action, { kind: "none" });
    assert.equal(pressed.state.view.kind, "list");
  }
  assert.ok(layoutWorkflowsManager({ state: pressWorkflowsManager(state, WORKFLOWS, "run", RUNS).state, list: LIST, columns: 120, rows: 40 }).some((line) => line.text.startsWith("Not trusted")));
  assert.deepEqual(pressWorkflowsManager(state, WORKFLOWS, "edit", RUNS).action, { kind: "edit", path: "/w/new-one.py", name: "new-one" });
});

test("e edits the file, r opens the form, Enter opens the newest run, h lists the runs", () => {
  const start = openWorkflowsManager();
  const pressed = (key: WorkflowsKey, state = start) => pressWorkflowsManager(state, WORKFLOWS, key, RUNS);
  assert.deepEqual(pressed("edit").action, { kind: "edit", path: "/w/pr-digest.py", name: "pr-digest" });
  assert.equal(pressed("run").state.view.kind, "form");
  assert.deepEqual(pressed("enter").action, { kind: "open-run", workflowRunId: "wr2" });
  const history = pressed("history").state;
  assert.deepEqual(history.view, { kind: "runs", id: digest.id, name: "pr-digest", selected: 0 });
  const lines = outline(history);
  assert.equal(lines[0], "pr-digest: runs");
  assert.ok(lines.includes("❯ 11:00 · running"));
  assert.ok(lines.includes("  08:30 · succeeded"));
  assert.deepEqual(pressed("enter", pressed("down", history).state).action, { kind: "open-run", workflowRunId: "wr1" });
  assert.deepEqual(pressed("back", history).state.view, { kind: "list", selected: 0 });
});

test("with no run yet, Enter and h say so and r still runs", () => {
  const state = press(openWorkflowsManager(), "down", "down", "down").state;
  const mineNever = pressWorkflowsManager(state, WORKFLOWS, "enter", RUNS);
  assert.deepEqual(mineNever.action, { kind: "none" });
  assert.ok(layoutWorkflowsManager({ state: mineNever.state, list: LIST, columns: 120, rows: 40 }).some((line) => line.text === "morning has not run yet. Press r to run it."));
  assert.equal(pressWorkflowsManager(state, WORKFLOWS, "history", RUNS).state.view.kind, "list");
  assert.equal(pressWorkflowsManager(state, WORKFLOWS, "run", RUNS).state.view.kind, "form");
});

test("the keys: arrows and Enter always, letters only while typing", () => {
  const key = (name: Press["name"], input = "", extra: Partial<Press> = {}): Press => ({ name, input, ctrl: false, meta: false, ...extra });
  assert.equal(workflowsManagerKeyOf(key("up")), "up");
  assert.equal(workflowsManagerKeyOf(key("return")), "enter");
  assert.equal(workflowsManagerKeyOf(key("escape")), "back");
  assert.equal(workflowsManagerKeyOf(key(null, "a")), null);
  assert.equal(workflowsManagerKeyOf(key(null, "e")), "edit");
  assert.equal(workflowsManagerKeyOf(key(null, "r")), "run");
  assert.equal(workflowsManagerKeyOf(key(null, "h")), "history");
  assert.equal(workflowsManagerKeyOf(key(null, "e", { ctrl: true })), null);
  assert.deepEqual(workflowsManagerKeyOf(key(null, "e"), true), { text: "e" });
  assert.deepEqual(workflowsManagerKeyOf(key(null, "a"), true), { text: "a" });
  assert.equal(workflowsManagerKeyOf(key(null, " "), true), "space");
  assert.equal(workflowsManagerKeyOf(key("tab"), true), "tab");
  assert.equal(workflowsManagerKeyOf(key("tab", "", { shift: true }), true), "shift-tab");
  assert.equal(workflowsManagerKeyOf(key("backspace"), true), "delete");
  assert.equal(workflowsManagerKeyOf(key("ctrl-u"), true), "clear");
  assert.equal(workflowsManagerTyping(openWorkflowsManager()), false);
  assert.equal(workflowsManagerTyping(press(openWorkflowsManager(), "run").state), true);
});

test("a narrow terminal cuts every line, and a short one keeps the hint", () => {
  const lines = layoutWorkflowsManager({ state: openWorkflowsManager(), list: LIST, columns: 30, rows: 6 });
  assert.equal(lines.length, 6);
  for (const line of lines) assert.ok((line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0) + line.text.length <= 30);
  assert.ok(lines.at(-1)?.text.startsWith("↑/↓"));
});
