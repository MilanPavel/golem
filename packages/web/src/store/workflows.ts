import type { WorkflowEntryInfo, WorkflowGetResult, WorkflowInputInfo, WorkflowListResult, WorkflowOutlineStep, WorkflowTriggerInfo } from "@golem/client";

export type { WorkflowEntryInfo, WorkflowGetResult, WorkflowInputInfo, WorkflowListResult, WorkflowOutlineStep, WorkflowTriggerInfo };

/** The query key of `workflow.list`; the folders it asked for follow. */
export const WORKFLOW_LIST_KEY = ["workflow.list"] as const;

/** The query key of `workflow.get`, one workflow with its steps and code. */
export const WORKFLOW_GET_KEY = ["workflow.get"] as const;

export function workflowGetKey(id: string): readonly unknown[] {
  return [...WORKFLOW_GET_KEY, id];
}
