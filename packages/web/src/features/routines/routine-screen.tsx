import type { ReactNode } from "react";
import { nextRunText } from "@golem/view";
import { useNavigate, usePageActions, useRoutine, useRoutineList } from "../../store/page-context.tsx";
import { actionErrorText } from "../../store/errors.ts";
import { routinePath } from "../../store/router.ts";
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

/** `/routines/:name`: one routine, from `routine.get`, with its History. */
export function RoutineScreen({ name, folder }: { name: string; folder: string | null }) {
  const query = useRoutine(name, folder);
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

/** `/routines?new`: the form for a new routine, empty or filled from the starter in `?new=`. Saving opens the routine. */
export function RoutineNewScreen({ starter }: { starter: string | null }) {
  const navigate = useNavigate();
  const now = useNow();
  return (
    <Frame>
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="font-sans text-lg font-semibold">New routine</h1>
        <LiveRoutineEditor
          key={starter ?? ""}
          create
          draft={starterDraft(starter) ?? {}}
          now={now}
          onSaved={(name) => navigate(routinePath(name))}
          onCancel={() => navigate(routinePath())}
        />
      </div>
    </Frame>
  );
}
