import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowEntryInfo, WorkflowOutlineStep, WorkflowTriggerInfo } from "../../store/workflows.ts";
import { folderName } from "../sessions/folder.ts";

/** What starts a workflow, in words. A workflow with no trigger of its own starts by hand, from the CLI, or from a routine. */
export function triggerText(trigger: WorkflowTriggerInfo | null | undefined): string {
  if (trigger === null || trigger === undefined || trigger.kind === "manual") return "By hand";
  if (trigger.kind === "schedule") return trigger.expr ? `On a schedule: ${trigger.expr}` : "On a schedule";
  return trigger.path ? `When a file changes: ${trigger.path}` : "When a file changes";
}

/** The last line of a traceback: the part that names what went wrong. */
export function errorLine(error: string | null | undefined): string {
  const lines = (error ?? "").split("\n").map((line) => line.trim());
  return lines.filter((line) => line !== "").at(-1) ?? "It did not load.";
}

/** The first line of the description, for a list row. */
function descriptionLine(description: string): string {
  return description.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

/** The second line of a row: why a file cannot run, or what the workflow does. */
export function workflowRowLine(workflow: WorkflowEntryInfo): string {
  if (workflow.state === "broken") return errorLine(workflow.error);
  if (workflow.state === "untrusted") return "not trusted";
  return descriptionLine(workflow.description ?? "") || triggerText(workflow.trigger);
}

export type WorkflowGroup = { key: string; label: string; folder: string | null; workflows: WorkflowEntryInfo[] };

/** This project's first, then yours, each in the daemon's order. With several projects each is named by its folder. */
export function workflowGroups(workflows: readonly WorkflowEntryInfo[]): WorkflowGroup[] {
  const projects = new Map<string, WorkflowGroup>();
  const yours: WorkflowEntryInfo[] = [];
  for (const workflow of workflows) {
    if (workflow.project === null || workflow.project === undefined) {
      yours.push(workflow);
      continue;
    }
    const group = projects.get(workflow.project) ?? { key: workflow.project, label: "", folder: workflow.project, workflows: [] };
    group.workflows.push(workflow);
    projects.set(workflow.project, group);
  }
  const found = [...projects.values()].map((group) => ({ ...group, label: projects.size === 1 ? "This project" : folderName(group.folder) }));
  if (yours.length > 0) found.push({ key: "", label: "Yours", folder: null, workflows: yours });
  return found;
}

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

/** This workflow's runs, from the Runs list: a workflow run's `origin` is `workflow:<name>`. Newest first, as the list is. */
export function workflowRuns(runs: readonly RunInfo[], name: string): RunInfo[] {
  return runs.filter((run) => run.kind === "workflow" && run.origin === `workflow:${name}`);
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
