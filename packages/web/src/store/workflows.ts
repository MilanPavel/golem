import type { WorkflowCancelResult, WorkflowCheckResult, WorkflowEntryInfo, WorkflowGetResult, WorkflowInputInfo, WorkflowListResult, WorkflowOutlineStep, WorkflowProblem, WorkflowResumeResult, WorkflowSaveResult, WorkflowStatusResult, WorkflowTriggerInfo } from "@golem/client";

export type { WorkflowCancelResult, WorkflowCheckResult, WorkflowEntryInfo, WorkflowGetResult, WorkflowInputInfo, WorkflowListResult, WorkflowOutlineStep, WorkflowProblem, WorkflowResumeResult, WorkflowSaveResult, WorkflowStatusResult, WorkflowTriggerInfo };

/** One run of a workflow, from `workflow.status`. */
export type WorkflowRunInfo = WorkflowStatusResult["run"];
/** One step of a run, with its saved result. */
export type WorkflowStepInfo = NonNullable<WorkflowStatusResult["steps"]>[number];
/** A review a run waits on, with its whole draft. */
export type WorkflowReviewInfo = NonNullable<WorkflowStatusResult["reviews"]>[number];
/** How a review is answered. */
export type ReviewVerdict = "approve" | "edit" | "reject";

/** The query key of `workflow.list`; the folders it asked for follow. */
export const WORKFLOW_LIST_KEY = ["workflow.list"] as const;

/** The query key of `workflow.get`, one workflow with its steps and code. */
export const WORKFLOW_GET_KEY = ["workflow.get"] as const;

export function workflowGetKey(id: string): readonly unknown[] {
  return [...WORKFLOW_GET_KEY, id];
}

/** The query key of `workflow.status`, one run with its steps and open reviews. Every `workflow.run.*` and `workflow.step.*` notification marks it stale. */
export const WORKFLOW_STATUS_KEY = ["workflow.status"] as const;

export function workflowStatusKey(workflowRunId: string): readonly unknown[] {
  return [...WORKFLOW_STATUS_KEY, workflowRunId];
}
