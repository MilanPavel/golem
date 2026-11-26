import type { ReactNode } from "react";
import { actionErrorText, revealErrorText } from "../../store/errors.ts";
import { useFolderDialog, useNavigate, usePageActions, useRunList, useWorkflow, useWorkflowList } from "../../store/page-context.tsx";
import { useNow } from "../sessions/use-now.ts";
import { WorkflowDetail } from "./workflow-detail.tsx";
import { workflowRuns } from "./text.ts";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-screen="workflows" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-5">
      {children}
    </div>
  );
}

/** `/workflows`: what a workflow is, and a hint to pick one from the panel. */
export function WorkflowsScreen() {
  const list = useWorkflowList();
  if (list.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{list.error ? `Could not load workflows. ${list.error.message}` : "Loading workflows."}</p>
      </Frame>
    );
  }
  const workflows = list.data.workflows;
  const broken = workflows.filter((workflow) => workflow.state === "broken").length;
  return (
    <Frame>
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Workflows</h1>
        <p className="text-sm text-muted">
          {workflows.length === 0 ? "No workflows yet." : workflows.length === 1 ? "1 workflow" : `${workflows.length} workflows`}
          {broken === 0 ? "" : ` · ${broken} broken`}
        </p>
        <p className="text-sm text-pretty text-muted">
          {workflows.length === 0
            ? "A workflow is a Python file in ~/.golem/workflows, or in .golem/workflows in a project. It chains steps that run one after another, each with its own model and tools."
            : "Pick one from the list to see what it does."}
        </p>
      </div>
    </Frame>
  );
}

/** `/workflows/:id`: one workflow, from `workflow.get`, with its runs from `run.list`. */
export function WorkflowScreen({ id }: { id: string }) {
  const query = useWorkflow(id);
  const runs = useRunList();
  const actions = usePageActions();
  const dialog = useFolderDialog();
  const navigate = useNavigate();
  const now = useNow();
  if (query.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{query.error ? actionErrorText(query.error, "There is no such workflow.") : "Loading the workflow."}</p>
      </Frame>
    );
  }
  const { workflow, steps, code } = query.data;
  return (
    <Frame>
      <WorkflowDetail
        key={id}
        workflow={workflow}
        steps={steps ?? []}
        code={code ?? null}
        runs={workflowRuns(runs.data?.runs ?? [], workflow.name)}
        now={now}
        onNavigate={navigate}
        onReveal={
          dialog
            ? async (path) => {
                try {
                  await actions.reveal(path);
                } catch (error) {
                  throw new Error(revealErrorText(error));
                }
              }
            : undefined
        }
      />
    </Frame>
  );
}
