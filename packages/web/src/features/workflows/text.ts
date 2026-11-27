import type { RoutineInfo } from "../../store/routines.ts";
import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowOutlineStep, WorkflowProblem } from "../../store/workflows.ts";

import { outlineLine, outlineNotes } from "@golem/view";

export { errorLine, groupWords, triggerText, workflowGroups, workflowRowLine, type WorkflowGroup } from "@golem/view";

/** The step's first line in the file (from 1), or null when the daemon sent none. */
export const stepStart = outlineLine;

/** The lines where a step starts, for the gutter of the Code tab. */
export function stepLines(steps: readonly WorkflowOutlineStep[]): Set<number> {
  const found = new Set<number>();
  for (const step of steps) {
    const line = stepStart(step);
    if (line !== null) found.add(line);
  }
  return found;
}

/** This workflow's runs, from the Runs list, including the ones a routine started: their `origin` is `workflow:<name>`. Newest first, as the list is. */
export function workflowRuns(runs: readonly RunInfo[], name: string): RunInfo[] {
  return runs.filter((run) => (run.kind === "workflow" || run.kind === "routine") && run.origin === `workflow:${name}`);
}

/** The routines whose `workflow` is this one, in the daemon's order. */
export function routinesStarting(routines: readonly RoutineInfo[], name: string): RoutineInfo[] {
  return routines.filter((routine) => routine.config.workflow === name);
}

/** How one outline step reads in the outline: what it is, then what repeats or guards it. */
export const stepNotes = outlineNotes;

/** The first and last line of a step (from 1), or null when the daemon sent none. The last is never before the first. */
export function stepRange(step: WorkflowOutlineStep): [number, number] | null {
  const first = stepStart(step);
  if (first === null) return null;
  const last: unknown = step.lines[1];
  return [first, typeof last === "number" && Number.isInteger(last) && last >= first ? last : first];
}

/** The step the caret is in: the last one that starts on or before `line`. Null before the first. */
export function stepAtLine(steps: readonly WorkflowOutlineStep[], line: number): WorkflowOutlineStep | null {
  let found: WorkflowOutlineStep | null = null;
  let best = 0;
  for (const step of steps) {
    const start = stepStart(step);
    if (start !== null && start <= line && start >= best) {
      found = step;
      best = start;
    }
  }
  return found;
}

/** Line (from 1) to step number (from 1, in outline order), for the margin of the code. */
export function stepNumberLines(steps: readonly WorkflowOutlineStep[]): Map<number, number> {
  const found = new Map<number, number>();
  steps.forEach((step, at) => {
    const line = stepStart(step);
    if (line !== null && !found.has(line)) found.set(line, at + 1);
  });
  return found;
}

/** How many lines differ between two texts: 0 when they are the same, at least 1 otherwise. */
export function changedLines(saved: string, text: string): number {
  if (saved === text) return 0;
  const before = saved.split("\n");
  const after = text.split("\n");
  // What is left between the lines both texts start and end with: the larger side is the number of changes.
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  return Math.max(1, before.length - head - tail, after.length - head - tail);
}

/** What a proposal does to a step: it is not in the saved outline (`new`), or it is but reads differently (`changed`). */
export type StepChange = "new" | "changed";

function stepSignature(step: WorkflowOutlineStep): string {
  return JSON.stringify([step.agent ?? null, step.group ?? null, step.for_each ?? null, step.condition ?? null, step.key ?? null, step.gets ?? null, step.budget ?? null]);
}

/** Step id to `new` or `changed` for the steps of a proposal, against the saved ones. A step is matched by its kind and title, each saved step once; an unchanged step is not in the map. */
export function compareSteps(before: readonly WorkflowOutlineStep[], after: readonly WorkflowOutlineStep[]): Map<string, StepChange> {
  const left = [...before];
  const found = new Map<string, StepChange>();
  for (const step of after) {
    const at = left.findIndex((old) => old.kind === step.kind && old.title === step.title);
    if (at < 0) {
      found.set(step.id, "new");
      continue;
    }
    const [old] = left.splice(at, 1);
    if (old !== undefined && stepSignature(old) !== stepSignature(step)) found.set(step.id, "changed");
  }
  return found;
}

/** One row of a line diff. `line` is the line number in the proposed text (from 1), null for a removed line. `skipped` is the count of unchanged lines a `skip` row stands for. */
export type DiffRow = { kind: "same" | "add" | "del" | "skip"; text: string; line: number | null; skipped?: number };

/** A line diff of two texts, with `context` unchanged lines kept around each change and the rest folded into `skip` rows. */
export function lineDiff(before: string, after: string, context = 2): { rows: DiffRow[]; added: number; removed: number } {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  // The longest common run of what is left between the shared head and tail, by dynamic programming.
  const width = y.length + 1;
  const table = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = x[i] === y[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const all: DiffRow[] = a.slice(0, head).map((text, at) => ({ kind: "same", text, line: at + 1 }));
  let i = 0;
  let j = 0;
  let line = head;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      line += 1;
      all.push({ kind: "same", text: y[j] ?? "", line });
      i += 1;
      j += 1;
    } else if (j < y.length && (i >= x.length || (table[i * width + j + 1] ?? 0) >= (table[(i + 1) * width + j] ?? 0))) {
      line += 1;
      all.push({ kind: "add", text: y[j] ?? "", line });
      j += 1;
    } else {
      all.push({ kind: "del", text: x[i] ?? "", line: null });
      i += 1;
    }
  }
  for (let k = a.length - tail; k < a.length; k += 1) {
    line += 1;
    all.push({ kind: "same", text: a[k] ?? "", line });
  }
  const changed = all.map((row) => row.kind !== "same");
  const rows: DiffRow[] = [];
  let hidden = 0;
  all.forEach((row, at) => {
    if (changed.slice(Math.max(0, at - context), at + context + 1).some(Boolean)) {
      if (hidden > 0) rows.push({ kind: "skip", text: "", line: null, skipped: hidden });
      hidden = 0;
      rows.push(row);
    } else hidden += 1;
  });
  if (hidden > 0) rows.push({ kind: "skip", text: "", line: null, skipped: hidden });
  return { rows, added: all.filter((row) => row.kind === "add").length, removed: all.filter((row) => row.kind === "del").length };
}

/** "2 problems, 1 warning", or "" for none. */
export function problemCounts(problems: readonly WorkflowProblem[]): string {
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const warnings = problems.length - errors;
  return [errors === 0 ? "" : errors === 1 ? "1 problem" : `${errors} problems`, warnings === 0 ? "" : warnings === 1 ? "1 warning" : `${warnings} warnings`].filter((part) => part !== "").join(", ");
}
