import { useState, type ReactNode } from "react";
import { NEW_WORKFLOW_BUTTON, modelNames } from "@golem/view";
import { actionErrorText, folderDialogErrorText, revealErrorText } from "../../store/errors.ts";
import { useAgentList, useFolderDialog, useModelList, useNavigate, useNewSessionFolder, usePageActions, useRoutineList, useRunList, useWorkflow, useWorkflowList, useWorkflowStarters } from "../../store/page-context.tsx";
import { useNow } from "../sessions/use-now.ts";
import { workflowNewPath, workflowPath } from "../../store/router.ts";
import { WorkflowDetail } from "./workflow-detail.tsx";
import { WorkflowNew } from "./workflow-new.tsx";
import { WorkflowsEmpty } from "./workflows-empty.tsx";
import { routinesStarting, workflowRuns } from "./text.ts";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-screen="workflows" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-5">
      {children}
    </div>
  );
}

/** `/workflows`: a way to the New workflow page when there are none, else a hint to pick one from the panel. */
export function WorkflowsScreen() {
  const list = useWorkflowList();
  const navigate = useNavigate();
  if (list.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{list.error ? `Could not load workflows. ${list.error.message}` : "Loading workflows."}</p>
      </Frame>
    );
  }
  const workflows = list.data.workflows;
  const broken = workflows.filter((workflow) => workflow.state === "broken").length;
  if (workflows.length === 0) {
    return (
      <Frame>
        <WorkflowsEmpty onNew={() => navigate(workflowNewPath())} />
      </Frame>
    );
  }
  return (
    <Frame>
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Workflows</h1>
        <p className="text-sm text-muted">
          {workflows.length === 1 ? "1 workflow" : `${workflows.length} workflows`}
          {broken === 0 ? "" : ` · ${broken} broken`}
        </p>
        <p className="text-sm text-pretty text-muted">Pick one from the list to see what it does, or make a new one with {NEW_WORKFLOW_BUTTON}.</p>
      </div>
    </Frame>
  );
}

/** `/workflows/new`: the ways to start a workflow, with the starters on it. */
export function WorkflowNewScreen() {
  const list = useWorkflowList();
  const starters = useWorkflowStarters();
  const actions = usePageActions();
  const navigate = useNavigate();
  const [folder] = useNewSessionFolder();
  const models = useModelList();
  const agents = useAgentList(folder);
  const [routineNote, setRoutineNote] = useState<string | null>(null);
  // A starter that reads a project goes in the folder a new session would start in.
  const add = async (starter: { id: string; needs_folder: boolean }, routine: boolean) => {
    try {
      const added = await actions.addWorkflowStarter(starter.id, starter.needs_folder ? folder : null, routine);
      const why = added.routine_problem ?? null;
      if (why === null) {
        navigate(workflowPath(added.id));
      } else {
        // The workflow is there; stay, so the reason can be read.
        setRoutineNote(`The workflow was added. ${why.charAt(0).toUpperCase()}${why.slice(1)}`);
      }
    } catch (error) {
      throw new Error(actionErrorText(error, "The workflow could not be added."));
    }
  };
  return (
    <Frame>
      {routineNote === null ? null : <p role="status" className="mb-3 max-w-2xl rounded-md border border-line px-2.5 py-1.5 text-sm text-pretty wrap-anywhere">{routineNote}</p>}
      <WorkflowNew
        starters={starters.data?.starters ?? []}
        workflows={list.data?.workflows ?? []}
        folder={folder}
        models={modelNames(models.data ?? null)}
        defaultModel={models.data?.default ?? null}
        agents={agents.data?.agents.map((agent) => agent.name)}
        onAddStarter={add}
        onDraft={actions.draftWorkflow}
        onCreate={actions.createWorkflow}
        onSave={actions.saveWorkflow}
        onCheck={actions.checkWorkflow}
        onEditStep={actions.editWorkflowStep}
        onNavigate={navigate}
      />
    </Frame>
  );
}

/** `/workflows/:id`: one workflow, from `workflow.get`, with its runs from `run.list`. */
export function WorkflowScreen({ id }: { id: string }) {
  const query = useWorkflow(id);
  const runs = useRunList();
  const routines = useRoutineList();
  const actions = usePageActions();
  const dialog = useFolderDialog();
  const navigate = useNavigate();
  const now = useNow();
  const agents = useAgentList(query.data?.workflow.project ?? null, query.data !== undefined);
  const models = useModelList(query.data !== undefined);
  if (query.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{query.error ? actionErrorText(query.error, "There is no such workflow.") : "Loading the workflow."}</p>
      </Frame>
    );
  }
  const { workflow, steps, code, code_hash: codeHash, workflow_model: workflowModel } = query.data;
  return (
    <Frame>
      <WorkflowDetail
        key={id}
        workflow={workflow}
        steps={steps ?? []}
        code={code ?? null}
        codeHash={codeHash ?? null}
        onCheck={(text) => actions.checkWorkflow(workflow.id, text)}
        onSave={(text, base) => actions.saveWorkflow(workflow.id, text, base)}
        onPropose={(text, ask, previous) => actions.proposeWorkflow(workflow.id, text, ask, previous)}
        onEditStep={(text, stepId, name, value) => actions.editWorkflowStep(workflow.id, text, stepId, name, value)}
        agents={agents.data?.agents.map((agent) => agent.name)}
        models={modelNames(models.data ?? null)}
        workflowModel={workflowModel ?? null}
        runs={workflowRuns(runs.data?.runs ?? [], workflow.name)}
        routines={routinesStarting(routines.data?.routines ?? [], workflow.name)}
        now={now}
        onNavigate={navigate}
        onStart={async (inputs, model) => {
          const runId = await (model === undefined ? actions.startWorkflow(workflow.id, inputs) : actions.startWorkflow(workflow.id, inputs, model));
          navigate(`/runs/${encodeURIComponent(runId)}`);
        }}
        onChooseFolder={
          dialog
            ? async (start) => {
                try {
                  return (await actions.chooseFolder(start)).path ?? null;
                } catch (error) {
                  throw new Error(folderDialogErrorText(error));
                }
              }
            : undefined
        }
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
