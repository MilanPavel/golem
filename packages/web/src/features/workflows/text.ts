import type { RoutineInfo } from "../../store/routines.ts";
import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowOutlineStep } from "../../store/workflows.ts";

export { errorLine, triggerText, workflowGroups, workflowRowLine, type WorkflowGroup } from "@golem/view";

/** The step's first line in the file (from 1), or null when the daemon sent none. The generated type leaves the pair open. */
export function stepStart(step: WorkflowOutlineStep): number | null {
  const first: unknown = step.lines[0];
  return typeof first === "number" && Number.isInteger(first) && first >= 1 ? first : null;
}

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
export function stepNotes(step: WorkflowOutlineStep): string[] {
  const notes: string[] = [step.kind];
  if (step.agent) notes.push(`agent ${step.agent}`);
  if (step.for_each) notes.push(`for each ${step.for_each}`);
  if (step.condition) notes.push(`if ${step.condition}`);
  if (step.gets) notes.push(`gets ${step.gets}`);
  if (step.budget) notes.push(`budget ${step.budget}`);
  return notes;
}
