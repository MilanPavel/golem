/**
 * The workflows list in words (3.9.4): what starts a workflow, why a file cannot run, the groups of the list. Pure,
 * typed by shape as `workflow.list` sends it, so the page and the terminal say the same.
 */

/** What starts a workflow. */
export type TriggerLike = { kind: string; expr?: string | null; path?: string | null };

/** The parts of a `WorkflowEntryInfo` these words read. */
export type WorkflowEntryLike = {
  id: string;
  name: string;
  state: string;
  description?: string;
  error?: string | null;
  project?: string | null;
  trigger?: TriggerLike | null;
};

/** What starts a workflow, in words. A workflow with no trigger of its own starts by hand, from the CLI, or from a routine. */
export function triggerText(trigger: TriggerLike | null | undefined): string {
  if (trigger === null || trigger === undefined || trigger.kind === "manual") return "By hand";
  if (trigger.kind === "schedule") return trigger.expr ? `On a schedule: ${trigger.expr}` : "On a schedule";
  return trigger.path ? `When a file changes: ${trigger.path}` : "When a file changes";
}

/** The last line of a traceback: the part that names what went wrong. */
export function errorLine(error: string | null | undefined): string {
  const lines = (error ?? "").split("\n").map((line) => line.trim());
  return lines.filter((line) => line !== "").at(-1) ?? "It did not load.";
}

function descriptionLine(description: string): string {
  return description.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

/** The second line of a row: why a file cannot run, or what the workflow does. */
export function workflowRowLine(workflow: WorkflowEntryLike): string {
  if (workflow.state === "broken") return errorLine(workflow.error);
  if (workflow.state === "untrusted") return "not trusted";
  return descriptionLine(workflow.description ?? "") || triggerText(workflow.trigger);
}

export type WorkflowGroup<T extends WorkflowEntryLike = WorkflowEntryLike> = { key: string; label: string; folder: string | null; workflows: T[] };

function folderName(folder: string): string {
  return folder.split("/").filter((part) => part !== "").at(-1) ?? "/";
}

/** This project's first, then yours, each in the daemon's order. With several projects each is named by its folder. */
export function workflowGroups<T extends WorkflowEntryLike>(workflows: readonly T[]): WorkflowGroup<T>[] {
  const projects = new Map<string, WorkflowGroup<T>>();
  const yours: T[] = [];
  for (const workflow of workflows) {
    if (workflow.project === null || workflow.project === undefined) {
      yours.push(workflow);
      continue;
    }
    const group = projects.get(workflow.project) ?? { key: workflow.project, label: "", folder: workflow.project, workflows: [] };
    group.workflows.push(workflow);
    projects.set(workflow.project, group);
  }
  const found = [...projects.values()].map((group) => ({ ...group, label: projects.size === 1 ? "This project" : folderName(group.key) }));
  if (yours.length > 0) found.push({ key: "", label: "Yours", folder: null, workflows: yours });
  return found;
}

/** The state of a workflow run as a word. */
export function workflowRunWords(status: string): string {
  return status === "pending" ? "queued" : status === "waiting" ? "waiting for you" : status;
}
