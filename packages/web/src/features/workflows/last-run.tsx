import { stepOutputLine } from "@golem/view";
import type { WorkflowOutlineStep, WorkflowStepInfo } from "../../store/workflows.ts";
import { Code } from "../../ui/code.tsx";
import { ResultView } from "../runs/result-view.tsx";

/** The last run of a workflow as the editor needs it: when it ran, and its steps as `workflow.status` sent them. */
export type LastRun = { runId: string; when: string; steps: readonly WorkflowStepInfo[] };

/**
 * The steps of a run that a step of the outline gave: those whose key is its id (a literal `key=`), else, when
 * its title is the only one of its kind in the outline, those with that title (a loop gives one per item).
 */
export function stepsOfOutline(outline: readonly WorkflowOutlineStep[], step: WorkflowOutlineStep, run: readonly WorkflowStepInfo[]): WorkflowStepInfo[] {
  const byKey = run.filter((given) => given.key === step.id);
  if (byKey.length > 0) return byKey;
  const sameTitle = outline.filter((other) => other.title === step.title && other.kind === step.kind);
  return sameTitle.length === 1 ? run.filter((given) => given.title === step.title && given.kind === step.kind) : [];
}

/** The outline step a run's step stands for: the one `stepsOfOutline` would match to it, or null. */
export function outlineStepOf(outline: readonly WorkflowOutlineStep[], given: Pick<WorkflowStepInfo, "key" | "title" | "kind">): WorkflowOutlineStep | null {
  const byId = outline.find((step) => step.id === given.key);
  if (byId !== undefined) return byId;
  const sameTitle = outline.filter((step) => step.title === given.title && step.kind === given.kind);
  return sameTitle.length === 1 ? sameTitle[0]! : null;
}

/** The one line a step gave in the last run, for its card. Several items read "3 items: <the first>". Empty with nothing to say. */
export function lastRunLine(given: readonly WorkflowStepInfo[]): string {
  const lines = given.map((one) => stepOutputLine(one)).filter((line) => line !== "");
  if (lines.length === 0) return "";
  return given.length > 1 ? `${given.length} items: ${lines[0]}` : lines[0]!;
}

/** "What it gave in the last run", in the pane of a step: each item's result in its own shape, with a link to that run. */
export function LastRunBlock({ given, when, onOpen }: { given: readonly WorkflowStepInfo[]; when: string; onOpen?: () => void }) {
  return (
    <section aria-label="What it gave in the last run" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-meta font-medium text-faint">What it gave in the last run</h4>
        <span className="text-meta text-faint">{when}</span>
        <span className="min-w-0 flex-1" />
        {onOpen === undefined ? null : (
          <button type="button" onClick={onOpen} className="text-meta text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2">
            Open that run
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3 rounded-md border border-line bg-bg p-3">
        {given.map((one) => (
          <div key={one.key} className="flex flex-col gap-2">
            {given.length > 1 && one.item ? <Code tone="muted">{one.item}</Code> : null}
            {one.result === null || one.result === undefined ? <p className="m-0 text-meta text-muted">{one.status === "failed" || one.status === "in_doubt" ? (one.error ?? "It failed.") : one.status === "running" ? "Still working." : one.status === "pending" ? "Not started." : "It gave nothing."}</p> : <ResultView result={one.result} label={`Last run of ${one.title}${one.item ? `, ${one.item}` : ""}`} />}
          </div>
        ))}
      </div>
    </section>
  );
}
