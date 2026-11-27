import { useState, type ReactNode } from "react";
import { actionErrorText, folderDialogErrorText, revealErrorText } from "../../store/errors.ts";
import { useAgentList, useFolderDialog, useNavigate, useNewSessionFolder, usePageActions, useRoutineList, useRunList, useWorkflow, useWorkflowList, useWorkflowStarters } from "../../store/page-context.tsx";
import { useNow } from "../sessions/use-now.ts";
import { workflowPath } from "../../store/router.ts";
import { WorkflowDetail } from "./workflow-detail.tsx";
import { WorkflowStarters, WorkflowsEmpty, starterStillToAdd } from "./workflows-empty.tsx";
import { routinesStarting, workflowRuns } from "./text.ts";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-screen="workflows" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-5">
      {children}
    </div>
  );
}

/** `/workflows`: the starters when there are no workflows, else a hint to pick one from the panel and the starters not added yet. */
export function WorkflowsScreen() {
  const list = useWorkflowList();
  const starters = useWorkflowStarters();
  const actions = usePageActions();
  const navigate = useNavigate();
  const [folder] = useNewSessionFolder();
  const [routineNote, setRoutineNote] = useState<string | null>(null);
  const note = routineNote === null ? null : <p role="status" className="mb-3 max-w-2xl rounded-md border border-line px-2.5 py-1.5 text-sm text-pretty wrap-anywhere">{routineNote}</p>;
  if (list.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{list.error ? `Could not load workflows. ${list.error.message}` : "Loading workflows."}</p>
      </Frame>
    );
  }
  const workflows = list.data.workflows;
  const broken = workflows.filter((workflow) => workflow.state === "broken").length;
  const known = starters.data?.starters ?? [];
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
  if (workflows.length === 0 && known.length > 0) {
    return (
      <Frame>
        {note}
        <WorkflowsEmpty starters={known} folder={folder} onAdd={add} />
      </Frame>
    );
  }
  return (
    <Frame>
      {note}
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
      <WorkflowStarters starters={starterStillToAdd(known, workflows, folder)} folder={folder} onAdd={add} />
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
  if (query.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{query.error ? actionErrorText(query.error, "There is no such workflow.") : "Loading the workflow."}</p>
      </Frame>
    );
  }
  const { workflow, steps, code, code_hash: codeHash } = query.data;
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
        runs={workflowRuns(runs.data?.runs ?? [], workflow.name)}
        routines={routinesStarting(routines.data?.routines ?? [], workflow.name)}
        now={now}
        onNavigate={navigate}
        onStart={async (inputs) => {
          const runId = await actions.startWorkflow(workflow.id, inputs);
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
