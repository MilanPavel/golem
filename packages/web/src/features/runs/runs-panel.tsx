import { runGroupHeading, runGroups, runName, runResultLine, runStatusWords } from "@golem/view";
import { runPath, runsPath, sessionPath } from "../../store/router.ts";
import { useNavigate, useRoute, useRunList } from "../../store/page-context.tsx";
import type { RunInfo } from "../../store/runs.ts";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { RunDot } from "../routines/index.ts";
import { useNow } from "../sessions/use-now.ts";

const LINK = "text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";

export type RunsPanelProps = {
  /** The daemon's answer, or null while it has not come. */
  runs: readonly RunInfo[] | null;
  /** The reason the answer did not come, if it did not. */
  error?: string | null;
  /** The session in view, when it is a run. */
  selected: string | null;
  /** The workflow run in view, by its `workflow_run_id`, when the page is a run's page. */
  selectedRun?: string | null;
  now: number;
  onNavigate: (path: string) => void;
};

/** The Runs panel's body: the same groups as the page, one line a run, and a link to the page. */
export function RunsPanel({ runs, error = null, selected, selectedRun = null, now, onNavigate }: RunsPanelProps) {
  let note: string | null = null;
  if (runs === null) note = error === null ? "Loading runs." : "Could not load runs.";
  else if (runs.length === 0) note = "Nothing has run yet.";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="px-2.5 text-sm">
        <Link href={runsPath()} onNavigate={onNavigate} className={LINK}>
          Open Runs
        </Link>
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
        {note === null ? null : <p className="px-2.5 py-2 text-sm text-muted">{note}</p>}
        {runs === null
          ? null
          : runGroups(runs, now).map((group) => (
              <div key={group.label}>
                <div className="mb-1 px-2.5 text-xs font-medium text-faint">{runGroupHeading(group)}</div>
                <ul aria-label={group.label} className="flex flex-col gap-px">
                  {group.items.map((run) => {
                    const open = run.workflow_run_id != null ? selectedRun === run.workflow_run_id : selected === run.session_id;
                    return (
                    <li key={run.session_id}>
                      <Link
                        href={run.workflow_run_id != null ? runPath(run.workflow_run_id) : sessionPath(run.session_id)}
                        onNavigate={onNavigate}
                        aria-current={open ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2 rounded-md py-1.5 pr-2.5 pl-2.5 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2",
                          open && "bg-surface text-ink ring-1 ring-line ring-inset",
                        )}
                      >
                        <RunDot status={run.status} word={runStatusWords(run.status)} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="min-w-0 truncate">{runName(run)}</span>
                          <span className={cn("truncate text-xs", run.status === "failed" ? "text-deny" : run.status === "waiting" ? "text-wait" : "text-faint")}>
                            {runResultLine(run)}
                          </span>
                        </span>
                      </Link>
                    </li>
                    );
                  })}
                </ul>
              </div>
            ))}
      </div>
    </div>
  );
}

/** The Runs panel on the live page. It refreshes its times once a minute. */
export function LiveRunsPanel() {
  const query = useRunList();
  const route = useRoute();
  const navigate = useNavigate();
  const now = useNow();
  return (
    <RunsPanel
      runs={query.data?.runs ?? null}
      error={query.error?.message ?? null}
      selected={route.name === "session" || route.name === "trace" ? route.id : null}
      selectedRun={route.name === "run" ? route.id : null}
      now={now}
      onNavigate={navigate}
    />
  );
}
