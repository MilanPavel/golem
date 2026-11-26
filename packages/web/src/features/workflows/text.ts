import type { RoutineInfo } from "../../store/routines.ts";
import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowOutlineStep, WorkflowProblem } from "../../store/workflows.ts";

import { outlineLine, outlineNotes } from "@golem/view";

export { errorLine, triggerText, workflowGroups, workflowRowLine, type WorkflowGroup } from "@golem/view";

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

/** How one outline step reads in the Overview: what it is, then what repeats or guards it. */
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

/** "2 problems, 1 warning", or "" for none. */
export function problemCounts(problems: readonly WorkflowProblem[]): string {
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const warnings = problems.length - errors;
  return [errors === 0 ? "" : errors === 1 ? "1 problem" : `${errors} problems`, warnings === 0 ? "" : warnings === 1 ? "1 warning" : `${warnings} warnings`].filter((part) => part !== "").join(", ");
}
