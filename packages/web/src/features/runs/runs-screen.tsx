import { needsYouCount, runGroups, runsOfWorkflow, workflowNameOfId } from "@golem/view";
import { useEffect, useState, type ReactNode } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { useNavigate, usePageActions, useRoute, useRunList, useWorkflowList, useWorkflowStatus } from "../../store/page-context.tsx";
import { runPath, runsPath, workflowPath } from "../../store/router.ts";
import type { RunInfo } from "../../store/runs.ts";
import type { WorkflowReadOutputResult, WorkflowRunInfo, WorkflowStepInfo } from "../../store/workflows.ts";
import { Link } from "../../ui/link.tsx";
import { useNow } from "../sessions/use-now.ts";
import { LiveLeadRuns } from "./lead-run.tsx";
import { RunResult } from "./run-result.tsx";
import { RunsList } from "./runs-list.tsx";

const LINK = "text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";

/** The summary line under the title: what needs you, and how many runs there are. */
export function runsSummary(runs: readonly RunInfo[]): string {
  const needs = needsYouCount(runs);
  const total = runs.length === 1 ? "1 run" : `${runs.length} runs`;
  return needs === 0 ? total : `${needs} need${needs === 1 ? "s" : ""} you · ${total}`;
}

/** The workflow runs of a list in the order the page shows them: the ones ↑ ↓ move through. */
export function shownWorkflowRuns(runs: readonly RunInfo[], now: number): string[] {
  return runGroups(runs, now).flatMap((group) => group.items.flatMap((run) => (run.workflow_run_id == null ? [] : [run.workflow_run_id])));
}

/** True for a key press that is meant for a field or a control, not for the list. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.closest("[role=tablist]") !== null;
}

export type RunPaneProps = {
  run: WorkflowRunInfo;
  steps: readonly WorkflowStepInfo[];
  onReadOutput: (index: number) => Promise<WorkflowReadOutputResult>;
  onNavigate: (path: string) => void;
};

/** One run's result beside the list, with the way to its steps. A run that stopped says where and why instead. */
export function RunPane({ run, steps, onReadOutput, onNavigate }: RunPaneProps) {
  const title = run.title !== null && run.title !== undefined && run.title !== "" ? run.title : run.name;
  const started = run.started_at === null || run.started_at === undefined ? "" : new Date(run.started_at).toLocaleString();
  const failed = run.status === "failed";
  const failedStep = steps.find((step) => step.status === "failed" || step.status === "in_doubt");
  return (
    <div role="group" aria-label={`Result of ${title}`} className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 className="m-0 text-sm font-medium">{title}</h2>
        {started === "" ? null : <p className="m-0 text-meta text-muted">{started}</p>}
      </header>
      {failed ? (
        <div role="group" aria-label="Why it stopped" className="flex flex-col gap-1 rounded-lg border border-deny bg-deny-soft p-3">
          <p className="m-0 text-sm font-medium text-deny">{failedStep === undefined ? "This run stopped" : `This run stopped at ${failedStep.title}`}</p>
          <p className="m-0 text-sm break-words">{failedStep?.error ?? run.error ?? "It did not say why."}</p>
        </div>
      ) : null}
      <RunResult key={run.workflow_run_id} run={run} steps={steps} onReadOutput={onReadOutput} />
      <p className="m-0 text-sm">
        <Link href={runPath(run.workflow_run_id)} onNavigate={onNavigate} className={LINK}>
          See how this run went, step by step
        </Link>
      </p>
    </div>
  );
}

/** The pane of a run on the live page: `workflow.status` for the run, the file's text on demand. */
function LiveRunPane({ id, onNavigate }: { id: string; onNavigate: (path: string) => void }) {
  const query = useWorkflowStatus(id);
  const actions = usePageActions();
  if (query.data === undefined) {
    return <p className="m-0 text-sm text-muted">{query.error ? actionErrorText(query.error, "There is no such run.") : "Loading the run."}</p>;
  }
  return <RunPane run={query.data.run} steps={query.data.steps ?? []} onReadOutput={(index) => actions.readWorkflowOutput(id, index)} onNavigate={onNavigate} />;
}

export type RunsViewProps = {
  /** The daemon's answer, or null while it has not come. */
  runs: readonly RunInfo[] | null;
  error?: string | null;
  now: number;
  /** The workflow the page is filtered to, by its id, or null for every run. */
  workflow?: string | null;
  onNavigate: (path: string) => void;
  /** The pane for a picked workflow run. */
  renderResult: (workflowRunId: string) => ReactNode;
  /** The filtered workflow's title, for the chip. Without it the chip says the name in its id. */
  workflowTitle?: string | null;
  /** The run picked at first. Without it, the first workflow run in the list. */
  initialSelected?: string | null;
  /** Shown above the list, where live work goes. */
  top?: ReactNode;
};

/**
 * The Runs page: a title, the workflow filter as a chip that clears, and the runs in groups with a workflow run's
 * result beside them. ↑ ↓ moves through the workflow runs.
 */
export function RunsView({ runs, error = null, now, workflow = null, onNavigate, renderResult, initialSelected = null, top, workflowTitle = null }: RunsViewProps) {
  const shown = runs === null || workflow === null ? runs : runsOfWorkflow(runs, workflow);
  const order = shown === null ? [] : shownWorkflowRuns(shown, now);
  const [picked, setPicked] = useState<string | null>(initialSelected);
  // A pick that is not in the list (another filter, a run that went away) is no pick: the first run is open.
  const selected = picked !== null && order.includes(picked) ? picked : (order[0] ?? null);
  const idName = workflow === null ? null : workflowNameOfId(workflow);
  // The chip says the workflow's title when the page knows it, else the name part of its id.
  const name = idName === null ? null : workflowTitle !== null && workflowTitle !== "" ? workflowTitle : idName;

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.key !== "ArrowDown" && event.key !== "ArrowUp") || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTyping(event.target)) return;
      const at = selected === null ? -1 : order.indexOf(selected);
      const next = order[at + (event.key === "ArrowDown" ? 1 : -1)];
      event.preventDefault();
      if (next !== undefined) setPicked(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let line = "What golem did while you were away, and what needs you.";
  if (shown !== null && shown.length > 0) line = runsSummary(shown);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-7 py-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Runs</h1>
        <p className="text-sm text-muted">{line}</p>
      </div>
      {name === null || workflow === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={runsPath()}
            onNavigate={onNavigate}
            aria-label={`Workflow: ${name}. Show every run`}
            className="inline-flex items-center gap-2 rounded-full border border-clay bg-clay-soft px-2.5 py-1 text-xs text-clay-ink outline-offset-2 outline-clay focus-visible:outline-2"
          >
            Workflow: {name} <span aria-hidden="true">✕</span>
          </Link>
          <Link href={workflowPath(workflow)} onNavigate={onNavigate} className={`${LINK} ml-auto text-meta`}>
            Open the workflow
          </Link>
        </div>
      )}
      {top}
      <div className="flex min-w-0 flex-col gap-5 lg:flex-row">
        <div className="flex min-w-0 max-w-4xl flex-col gap-4 lg:w-1/2 lg:shrink-0">
          <RunsList
            runs={shown}
            error={error}
            now={now}
            onNavigate={onNavigate}
            selectedRun={selected}
            onSelectRun={setPicked}
            empty={name === null ? undefined : `${name} has not run yet.`}
          />
        </div>
        {selected === null ? null : <div className="min-w-0 flex-1">{renderResult(selected)}</div>}
      </div>
    </div>
  );
}

/** `/runs`: every routine firing, detached ask and workflow run, newest first, in the groups Needs you, Running, Today and Earlier. `?workflow=` keeps one workflow's. */
export function RunsScreen() {
  const query = useRunList();
  const navigate = useNavigate();
  const route = useRoute();
  const now = useNow();
  const workflows = useWorkflowList();
  const workflow = route.name === "runs" ? route.workflow : null;
  const title = workflow === null ? null : (workflows.data?.workflows.find((entry) => entry.id === workflow)?.title ?? null);
  return (
    <div data-screen="runs" className="flex min-h-0 flex-1 flex-col">
      <RunsView
        workflowTitle={title}
        runs={query.data?.runs ?? null}
        error={query.error?.message ?? null}
        now={now}
        workflow={workflow}
        onNavigate={navigate}
        renderResult={(id) => <LiveRunPane key={id} id={id} onNavigate={navigate} />}
        top={<LiveLeadRuns onNavigate={navigate} />}
      />
    </div>
  );
}
