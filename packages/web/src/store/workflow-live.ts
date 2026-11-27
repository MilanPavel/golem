import type { WorkflowNotice, WorkflowStatusResult } from "@golem/client";

/**
 * A run's live notifications folded into its cached `workflow.status`, so an open run page ticks along
 * without asking again. Pure: it takes the answer as it is cached and the notice, and says what the answer is now.
 * `stale` is true when the notice cannot give the page all it needs (a review's draft, or a result too large for an
 * event), so the page reads the run once more.
 */
export type Folded = { status: WorkflowStatusResult; stale: boolean };

/** The query key of a run's `workflow.status`; the same as `workflowStatusKey`. Kept here so the wiring does not import the page's hooks. */
export function liveStatusKey(workflowRunId: string): readonly unknown[] {
  return ["workflow.status", workflowRunId];
}

/** True when an event left out a value it said it has: the size is there, the value is not. */
const cut = (size: number | undefined, value: unknown): boolean => (size ?? 0) > 0 && (value === null || value === undefined);

export function foldWorkflowNotice(current: WorkflowStatusResult, notice: WorkflowNotice): Folded | null {
  const id = notice.params.workflow_run_id;
  if (current.run.workflow_run_id !== id) return null;
  // The reviews a run waits on come only from `workflow.status`; while one is open, any change may have answered it.
  const asked = (current.reviews ?? []).length > 0;
  if (notice.kind === "run") {
    const event = notice.params;
    const done = notice.method === "workflow.run.done";
    const run = {
      ...current.run,
      status: event.status,
      session_id: event.session_id ?? current.run.session_id ?? null,
      started_at: event.started_at ?? current.run.started_at ?? null,
      finished_at: event.finished_at ?? null,
      error: event.error ?? null,
      steps_expected: event.steps_expected ?? null,
      ...(done ? { result: event.result ?? undefined, summary: current.run.summary ?? event.summary ?? null } : {}),
    };
    // A run that waits has reviews, whose drafts only `workflow.status` has.
    const stale = asked || notice.method === "workflow.run.waiting" || (done && cut(event.result_size, event.result));
    return { status: { ...current, run }, stale };
  }
  if (notice.kind === "step") {
    const { result_size, ...withRun } = notice.params;
    const info: Omit<typeof withRun, "workflow_run_id"> & { workflow_run_id?: string } = { ...withRun };
    delete info.workflow_run_id;
    const steps = current.steps ?? [];
    const at = steps.findIndex((step) => step.key === info.key);
    const next = at < 0 ? [...steps, info] : steps.map((step, index) => (index === at ? { ...step, ...info } : step));
    const stale = asked || notice.method === "workflow.step.waiting" || cut(result_size, info.result);
    return { status: { ...current, steps: next }, stale };
  }
  const { position, title, summary, value, size } = notice.params;
  const outputs = current.run.outputs ?? [];
  if (position > outputs.length) return { status: current, stale: true };
  const output = { title: title ?? null, summary: summary ?? null, value: value ?? undefined };
  const next = position === outputs.length ? [...outputs, output] : outputs.map((one, index) => (index === position ? output : one));
  return { status: { ...current, run: { ...current.run, outputs: next, summary: current.run.summary ?? next[0]?.summary ?? null } }, stale: cut(size, value) };
}
