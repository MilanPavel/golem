import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkflowEntryInfo } from "@golem/client";

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
  assert.equal(lines.at(-1), "↑/↓ to navigate · Enter to run · Esc to close");
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
  const form = press(openWorkflowsManager(), "enter").state.view;
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
  const formLines = screen(press(openWorkflowsManager(), "enter").state);
  assert.equal(formLines[0], "Run pr-digest");
  assert.ok(formLines.some((line) => line.startsWith("❯ repo *") && line.includes("[▏]") && line.includes("str · required")));
  assert.ok(formLines.some((line) => line.includes("days") && line.includes("[7]") && line.includes("int · default 7")));
  assert.ok(formLines.some((line) => line.includes("mode") && line.includes("< fast >")));
  assert.ok(formLines.some((line) => line.includes("dry") && line.includes("[ ] no")));
});

test("the form edits text, deletes, clears, and moves between fields", () => {
  let state = press(openWorkflowsManager(), "enter").state;
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
  let state = press(openWorkflowsManager(), "enter", "down", "down").state;
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
  let state = press(openWorkflowsManager(), "enter", "down", "clear").state;
  state = press(state, text("abc")).state;
  const sent = press(state, "enter");
  assert.deepEqual(sent.action, { kind: "none" });
  assert.equal(sent.state.view.kind === "form" ? sent.state.view.focus : null, 0);
  const lines = screen(sent.state);
  assert.ok(lines.some((line) => line.includes("✘ Required.")));
  assert.ok(lines.some((line) => line.includes("✘ Enter a number.")));
});

test("Enter on a valid form starts the workflow with typed inputs, and the keys wait until it answers", () => {
  let state = press(openWorkflowsManager(), "enter", text("golem")).state;
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
  const state = press(openWorkflowsManager(), "enter", text("golem"), "down", "clear").state;
  const sent = press(state, "enter");
  assert.deepEqual(sent.action.kind === "start" ? sent.action.inputs : null, { repo: "golem", mode: "fast", dry: false });
});

test("Esc in the form goes back to the list", () => {
  const back = press(openWorkflowsManager(), "enter", "back");
  assert.equal(back.state.view.kind, "list");
  assert.equal(back.state.open, true);
});

test("a broken workflow opens a form with its error as a warning, and a workflow without inputs says so", () => {
  const form = press(openWorkflowsManager(), "down", "enter").state;
  assert.equal(form.view.kind, "form");
  const lines = screen(form);
  assert.equal(lines[0], "Run release-check");
  assert.ok(lines.includes("Starts one run now. This workflow takes no inputs."));
  assert.ok(lines.some((line) => line.startsWith("! ") && line.endsWith("ImportError: no module named gh")));
  const sent = press(form, "enter");
  assert.deepEqual(sent.action.kind === "start" ? sent.action.inputs : null, {});
});

test("an untrusted workflow warns in its form", () => {
  const form = press(openWorkflowsManager(), "down", "down", "enter").state;
  assert.ok(screen(form).some((line) => line.includes("not trusted yet")));
});

test("the keys: arrows and Enter always, letters only while typing", () => {
  const key = (name: Press["name"], input = "", extra: Partial<Press> = {}): Press => ({ name, input, ctrl: false, meta: false, ...extra });
  assert.equal(workflowsManagerKeyOf(key("up")), "up");
  assert.equal(workflowsManagerKeyOf(key("return")), "enter");
  assert.equal(workflowsManagerKeyOf(key("escape")), "back");
  assert.equal(workflowsManagerKeyOf(key(null, "a")), null);
  assert.deepEqual(workflowsManagerKeyOf(key(null, "a"), true), { text: "a" });
  assert.equal(workflowsManagerKeyOf(key(null, " "), true), "space");
  assert.equal(workflowsManagerKeyOf(key("tab"), true), "tab");
  assert.equal(workflowsManagerKeyOf(key("tab", "", { shift: true }), true), "shift-tab");
  assert.equal(workflowsManagerKeyOf(key("backspace"), true), "delete");
  assert.equal(workflowsManagerKeyOf(key("ctrl-u"), true), "clear");
  assert.equal(workflowsManagerTyping(openWorkflowsManager()), false);
  assert.equal(workflowsManagerTyping(press(openWorkflowsManager(), "enter").state), true);
});

test("a narrow terminal cuts every line, and a short one keeps the hint", () => {
  const lines = layoutWorkflowsManager({ state: openWorkflowsManager(), list: LIST, columns: 30, rows: 6 });
  assert.equal(lines.length, 6);
  for (const line of lines) assert.ok((line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0) + line.text.length <= 30);
  assert.ok(lines.at(-1)?.text.startsWith("↑/↓"));
});
