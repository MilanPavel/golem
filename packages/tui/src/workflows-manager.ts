import type { WorkflowEntryInfo } from "@golem/client";
import {
  fieldProblem,
  initialValues,
  inputFields,
  startInputs,
  workflowGroups,
  workflowRowLine,
  type InputField,
} from "@golem/view";

import type { Press } from "./keys.ts";
import type { McpManagerLine } from "./mcp-manager.ts";

/**
 * `/workflows` (3.9.4): the workflows golem found, grouped as the web page groups them, a broken one with its
 * error and an untrusted one marked, and a small form to start one with its inputs. Pure: the state says where
 * the pointer is and what each field holds; the app holds the list and calls `workflow.start`.
 */

export type WorkflowForm = {
  kind: "form";
  id: string;
  name: string;
  /** Why the file cannot run, for a broken or untrusted workflow. The run is still tried, and the daemon answers. */
  warning: string | null;
  fields: readonly InputField[];
  values: Readonly<Record<string, string>>;
  focus: number;
  /** A field is complained about only after the first Enter. */
  touched: boolean;
  /** What the daemon said when the start failed. */
  error: string | null;
  /** `workflow.start` was sent and has not answered, so keys wait. */
  starting: boolean;
};

export type WorkflowsView = { kind: "list"; selected: number } | WorkflowForm;

export type WorkflowsManagerState = { open: boolean; view: WorkflowsView };

/** The workflows `workflow.list` returned, or why it could not. */
export type WorkflowList = { workflows: readonly WorkflowEntryInfo[] | null; error: string | null };

export const closedWorkflowsManager: WorkflowsManagerState = { open: false, view: { kind: "list", selected: 0 } };

export function openWorkflowsManager(): WorkflowsManagerState {
  return { open: true, view: { kind: "list", selected: 0 } };
}

export type WorkflowsKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "back"
  | "tab"
  | "shift-tab"
  | "space"
  | "delete"
  | "clear"
  | { text: string };

export type WorkflowsAction =
  | { kind: "none" }
  | { kind: "close" }
  /** Start the workflow `id`. The app answers with `failedWorkflowStart` or opens the run. */
  | { kind: "start"; id: string; name: string; inputs: Record<string, unknown> };

const NONE: WorkflowsAction = { kind: "none" };

/** The form takes text, so letters are not shortcuts there. */
export function workflowsManagerTyping(state: WorkflowsManagerState): boolean {
  return state.open && state.view.kind === "form";
}

export function workflowsManagerKeyOf(press: Press, typing = false): WorkflowsKey | null {
  if (press.name === "up" || press.name === "down" || press.name === "left" || press.name === "right") return press.name;
  if (press.name === "return") return "enter";
  if (press.name === "escape") return "back";
  if (!typing) return null;
  if (press.name === "tab") return press.shift === true ? "shift-tab" : "tab";
  if (press.name === "backspace") return "delete";
  if (press.name === "ctrl-u" || press.name === "ctrl-w") return "clear";
  const text = press.input.replace(/[\r\n]/g, "");
  if ((press.name === null || press.name === "question") && !press.ctrl && !press.meta && text.length > 0) {
    return text === " " ? "space" : { text };
  }
  return null;
}

/** The workflows in the order of the screen: the groups one after the other. */
export function orderedWorkflows(workflows: readonly WorkflowEntryInfo[]): WorkflowEntryInfo[] {
  return workflowGroups(workflows).flatMap((group) => group.workflows);
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

/** The form for a workflow: each field at its default. */
export function startForm(workflow: WorkflowEntryInfo): WorkflowForm {
  const fields = inputFields(workflow.inputs);
  return {
    kind: "form",
    id: workflow.id,
    name: workflow.name,
    warning: workflow.state === "broken" ? workflowRowLine(workflow) : workflow.state === "untrusted" ? "This workflow is not trusted yet, so the daemon may not run it." : null,
    fields,
    values: initialValues(fields),
    focus: 0,
    touched: false,
    error: null,
    starting: false,
  };
}

/** What is wrong with each field, in field order. Null where it is fine. */
export function formProblems(form: WorkflowForm): (string | null)[] {
  return form.fields.map((field) => fieldProblem(field, form.values[field.name] ?? ""));
}

/** The form after the daemon refused to start. */
export function failedWorkflowStart(state: WorkflowsManagerState, message: string): WorkflowsManagerState {
  return state.view.kind === "form" ? { ...state, view: { ...state.view, starting: false, error: message } } : state;
}

function setValue(form: WorkflowForm, field: InputField, value: string): WorkflowForm {
  return { ...form, values: { ...form.values, [field.name]: value }, error: null };
}

function cycle(field: InputField, current: string, step: number): string {
  if (field.kind === "bool") return current === "true" ? "false" : "true";
  const at = field.choices.indexOf(current);
  const next = (at + step + field.choices.length) % field.choices.length;
  return field.choices[at < 0 ? 0 : next] ?? current;
}

function pressForm(state: WorkflowsManagerState, form: WorkflowForm, key: WorkflowsKey): { state: WorkflowsManagerState; action: WorkflowsAction } {
  const to = (next: WorkflowForm, action: WorkflowsAction = NONE) => ({ state: { ...state, view: next }, action });
  if (form.starting) return { state, action: NONE };
  if (key === "back") return { state: { ...state, view: { kind: "list", selected: 0 } }, action: NONE };
  const count = form.fields.length;
  const field = form.fields[clamp(form.focus, count)];
  const value = field === undefined ? "" : (form.values[field.name] ?? "");
  if (key === "enter") {
    const problems = formProblems(form);
    if (problems.some((problem) => problem !== null)) {
      const first = problems.findIndex((problem) => problem !== null);
      return to({ ...form, touched: true, focus: first, error: null });
    }
    return to({ ...form, touched: true, error: null, starting: true }, { kind: "start", id: form.id, name: form.name, inputs: startInputs(form.fields, form.values) });
  }
  if (key === "up" || key === "shift-tab") return to({ ...form, focus: clamp(form.focus - 1, count) });
  if (key === "down" || key === "tab") return to({ ...form, focus: clamp(form.focus + 1, count) });
  if (field === undefined) return { state, action: NONE };
  if (field.kind === "bool" || field.kind === "choice") {
    if (key === "space" || key === "right") return to(setValue(form, field, cycle(field, value, 1)));
    if (key === "left") return to(setValue(form, field, cycle(field, value, -1)));
    return { state, action: NONE };
  }
  if (key === "delete") return to(setValue(form, field, [...value].slice(0, -1).join("")));
  if (key === "clear") return to(setValue(form, field, ""));
  if (key === "space") return to(setValue(form, field, `${value} `));
  if (typeof key === "object") return to(setValue(form, field, value + key.text));
  return { state, action: NONE };
}

export function pressWorkflowsManager(
  state: WorkflowsManagerState,
  workflows: readonly WorkflowEntryInfo[],
  key: WorkflowsKey,
): { state: WorkflowsManagerState; action: WorkflowsAction } {
  const view = state.view;
  if (view.kind === "form") return pressForm(state, view, key);
  const items = orderedWorkflows(workflows);
  const selected = clamp(view.selected, items.length);
  if (key === "back") return { state: closedWorkflowsManager, action: { kind: "close" } };
  if (key === "up" || key === "down") return { state: { ...state, view: { kind: "list", selected: clamp(selected + (key === "up" ? -1 : 1), items.length) } }, action: NONE };
  const picked = items[selected];
  if (key === "enter" && picked !== undefined) return { state: { ...state, view: startForm(picked) }, action: NONE };
  return { state, action: NONE };
}

/** `✔` can run, `✘` broken, `!` not trusted. */
export function workflowMark(workflow: Pick<WorkflowEntryInfo, "state">): { text: string; tone: "ok" | "bad" | "wait" } {
  if (workflow.state === "broken") return { text: "✘", tone: "bad" };
  if (workflow.state === "untrusted") return { text: "!", tone: "wait" };
  return { text: "✔", tone: "ok" };
}

const LIST_HINT = "↑/↓ to navigate · Enter to run · Esc to close";
const FORM_HINT = "↑/↓ field · type to edit · ←/→ or Space to choose · Enter to run · Esc to go back";
const STARTING_HINT = "Starting…";
const NO_WORKFLOWS = "Put a workflow in workflows/ of this folder or in ~/.golem/workflows/, and it shows here.";

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function listLines(workflows: readonly WorkflowEntryInfo[], selected: number): McpManagerLine[] {
  const groups = workflowGroups(workflows);
  if (groups.length === 0) return [{ text: "Workflows", bold: true }, { text: "no workflows", dim: true }, { text: "" }, { text: NO_WORKFLOWS }];
  const items = groups.flatMap((group) => group.workflows);
  const nameWidth = Math.max(...items.map((workflow) => workflow.name.length));
  const broken = items.filter((workflow) => workflow.state === "broken").length;
  const untrusted = items.filter((workflow) => workflow.state === "untrusted").length;
  const counts = [`${items.length} ${items.length === 1 ? "workflow" : "workflows"}`];
  if (broken > 0) counts.push(`${broken} broken`);
  if (untrusted > 0) counts.push(`${untrusted} not trusted`);
  const chosen = clamp(selected, items.length);
  const lines: McpManagerLine[] = [{ text: "Workflows", bold: true }, { text: counts.join(" · "), dim: true }];
  let index = 0;
  for (const group of groups) {
    lines.push({ text: "" }, { text: `  ${group.label}`, bold: true });
    for (const workflow of group.workflows) {
      lines.push({
        prefix: index === chosen ? "❯ " : "  ",
        mark: workflowMark(workflow),
        text: `${workflow.name.padEnd(nameWidth)}  ${workflowRowLine(workflow)}`,
        selected: index === chosen,
        dim: workflow.state === "untrusted",
      });
      index += 1;
    }
  }
  return lines;
}

/** `[7]`, `< fast >`, `[x]`: how a field shows its value. The cursor is drawn in the focused text field. */
export function fieldValueText(field: InputField, value: string, focused: boolean): string {
  if (field.kind === "bool") return value === "true" ? "[x] yes" : "[ ] no";
  if (field.kind === "choice") return `< ${value === "" ? "choose" : value} >`;
  return `[${value}${focused ? "▏" : ""}]`;
}

function fieldNote(field: InputField): string {
  const parts = [field.typeName === "" ? field.kind : field.typeName];
  parts.push(field.required ? "required" : field.default === null || field.default === "" ? "optional" : `default ${field.default}`);
  return parts.join(" · ");
}

function formLines(form: WorkflowForm, rows: number): McpManagerLine[] {
  const lines: McpManagerLine[] = [{ text: `Run ${form.name}`, bold: true }];
  lines.push({
    text: form.fields.length === 0 ? "Starts one run now. This workflow takes no inputs." : "Starts one run now. The form comes from the workflow's inputs.",
    dim: true,
  });
  if (form.warning !== null) lines.push({ text: form.warning, mark: { text: "!", tone: "wait" } });
  lines.push({ text: "" });
  const labelWidth = Math.max(0, ...form.fields.map((field) => field.name.length + (field.required ? 2 : 0)));
  const valueWidth = Math.max(0, ...form.fields.map((field) => fieldValueText(field, form.values[field.name] ?? "", true).length));
  const problems = formProblems(form);
  for (const [index, field] of form.fields.entries()) {
    const chosen = index === form.focus;
    const value = form.values[field.name] ?? "";
    const label = `${field.name}${field.required ? " *" : ""}`.padEnd(labelWidth);
    lines.push({
      prefix: chosen ? "❯ " : "  ",
      text: `${label}  ${fieldValueText(field, value, chosen).padEnd(valueWidth)}  ${fieldNote(field)}`,
      selected: chosen,
    });
    const problem = form.touched ? problems[index] : null;
    if (problem !== null && problem !== undefined) lines.push({ prefix: "    ", text: problem, mark: { text: "✘", tone: "bad" } });
  }
  if (form.error !== null) lines.push({ text: "" }, { text: form.error, mark: { text: "✘", tone: "bad" } });
  return lines.slice(0, Math.max(0, rows));
}

/** Keep the selected line on screen. */
function scrollToSelected(lines: McpManagerLine[], room: number): McpManagerLine[] {
  if (lines.length <= room) return lines;
  const selected = Math.max(0, lines.findIndex((line) => line.selected === true));
  const start = Math.min(Math.max(0, selected - room + 1), lines.length - room);
  return lines.slice(start, start + room);
}

export function layoutWorkflowsManager(input: { state: WorkflowsManagerState; list: WorkflowList; columns: number; rows: number }): McpManagerLine[] {
  const width = Math.max(1, input.columns);
  const room = Math.max(0, input.rows - 2);
  const view = input.state.view;
  let body: McpManagerLine[];
  let hint = LIST_HINT;
  if (view.kind === "form") {
    body = formLines(view, room);
    hint = view.starting ? STARTING_HINT : FORM_HINT;
  } else if (input.list.error !== null) {
    body = [{ text: "Workflows", bold: true }, { text: "" }, { text: input.list.error }];
  } else if (input.list.workflows === null) {
    body = [{ text: "Workflows", bold: true }, { text: "" }, { text: "asking the daemon…", dim: true }];
  } else {
    body = scrollToSelected(listLines(input.list.workflows, view.selected), room);
  }
  const lines = [...body.slice(0, room), { text: "" }, { text: hint, dim: true }];
  return lines.slice(0, Math.max(0, input.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}
