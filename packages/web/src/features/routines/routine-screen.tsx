import type { ReactNode } from "react";
import { nextRunText } from "@golem/view";
import { useNavigate, usePageActions, useRoutine, useRoutineList, useWorkflowList } from "../../store/page-context.tsx";
import { actionErrorText } from "../../store/errors.ts";
import { routinePath } from "../../store/router.ts";
import type { RoutineInfo } from "../../store/routines.ts";
import type { WorkflowEntryInfo } from "../../store/workflows.ts";
import { useNow } from "../sessions/use-now.ts";
import { RoutineDetail } from "./routine-detail.tsx";
import { LiveRoutineEditor } from "./routine-editor-live.tsx";
import { RoutinesEmpty, starterDraft } from "./routines-empty.tsx";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-screen="routines" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-5">
      {children}
    </div>
  );
}

/** `/routines`: the empty state when there are no routines, else a hint to pick one from the panel. */
export function RoutinesScreen() {
  const list = useRoutineList();
  const navigate = useNavigate();
  const now = useNow();
  if (list.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{list.error ? `Could not load routines. ${list.error.message}` : "Loading routines."}</p>
      </Frame>
    );
  }
  const routines = list.data.routines;
  if (routines.length === 0) {
    return (
      <Frame>
        <RoutinesEmpty onNavigate={navigate} />
      </Frame>
    );
  }
  const soonest = routines
    .filter((routine) => routine.next_at !== null && routine.next_at !== undefined)
    .sort((a, b) => Date.parse(a.next_at ?? "") - Date.parse(b.next_at ?? ""))[0];
  return (
    <Frame>
      <div className="flex flex-col gap-1">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Routines</h1>
        <p className="text-sm text-muted">
          {routines.length === 1 ? "1 routine" : `${routines.length} routines`}
          {soonest === undefined ? "" : ` · ${soonest.config.name} ${nextRunText(soonest.next_at, now)}`}
        </p>
        <p className="text-sm text-muted">Pick one from the list to see its runs.</p>
      </div>
    </Frame>
  );
}

/** The id of the workflow a routine runs: the project's own first, then the user's, as the daemon looks it up. */
function workflowIdOf(routine: RoutineInfo, workflows: readonly WorkflowEntryInfo[] | undefined): string | null {
  const name = routine.config.workflow;
  if (name === undefined || name === null || workflows === undefined) return null;
  const named = workflows.filter((each) => each.name === name);
  const mine = named.find((each) => (each.project ?? null) === (routine.folder ?? null)) ?? named.find((each) => each.project === undefined || each.project === null);
  return mine?.id ?? null;
}

/** `/routines/:name`: one routine, from `routine.get`, with its History. */
export function RoutineScreen({ name, folder }: { name: string; folder: string | null }) {
  const query = useRoutine(name, folder);
  const workflows = useWorkflowList();
  const actions = usePageActions();
  const navigate = useNavigate();
  const now = useNow();
  if (query.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{query.error ? actionErrorText(query.error, `There is no routine called ${name}.`) : "Loading the routine."}</p>
      </Frame>
    );
  }
  const { routine, runs } = query.data;
  return (
    <Frame>
      <RoutineDetail
        key={`${folder ?? ""}/${name}`}
        routine={routine}
        workflowId={workflowIdOf(routine, workflows.data?.workflows)}
        runs={runs ?? []}
        now={now}
        onNavigate={navigate}
        onRun={() => actions.runRoutine(name, folder)}
        onRemove={
          routine.source === "user"
            ? async () => {
                await actions.removeRoutine(name);
                navigate(routinePath());
              }
            : undefined
        }
        editor={
          routine.source === "user"
            ? (done) => <LiveRoutineEditor create={false} draft={routine.config} now={now} onSaved={() => done(true)} onCancel={() => done(false)} />
            : undefined
        }
      />
    </Frame>
  );
}

/** A routine name from a workflow's name: lowercase letters, digits and dashes, with no dash at either end. */
export function routineNameFor(workflowName: string): string {
  return workflowName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** `/routines?new`: the form for a new routine, empty or filled from the starter in `?new=` or the workflow in `&workflow=`. Saving opens the routine. */
export function RoutineNewScreen({ starter, workflow = null }: { starter: string | null; workflow?: string | null }) {
  const navigate = useNavigate();
  const now = useNow();
  const workflows = useWorkflowList();
  if (workflow !== null && workflows.data === undefined && !workflows.error) {
    return (
      <Frame>
        <p className="text-sm text-muted">Loading the workflow.</p>
      </Frame>
    );
  }
  const entry = workflow === null ? undefined : workflows.data?.workflows.find((each) => each.id === workflow);
  const draft = entry === undefined ? (starterDraft(starter) ?? {}) : { name: routineNameFor(entry.name), workflow: entry.name };
  return (
    <Frame>
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="font-ui text-lg font-semibold">New routine</h1>
        {workflow !== null && entry === undefined ? <p className="text-sm text-muted">That workflow is not in the list, so the form is empty.</p> : null}
        <LiveRoutineEditor
          key={`${starter ?? ""}/${workflow ?? ""}`}
          create
          draft={draft}
          now={now}
          onSaved={(name) => navigate(routinePath(name))}
          onCancel={() => navigate(routinePath())}
        />
      </div>
    </Frame>
  );
}
