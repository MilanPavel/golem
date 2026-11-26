import type { RoutineInfo } from "../../store/routines.ts";
import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowOutlineStep } from "../../store/workflows.ts";

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
