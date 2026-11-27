import { useId } from "react";
import { runDuration, runGroupHeading, runGroups, runKey, runName, runResultLine, runRowLine, runStartedText, runStatusWords, runStepsWords, type RunGroup } from "@golem/view";
import { runPath, runsPath, sessionPath } from "../../store/router.ts";
import type { RunInfo } from "../../store/runs.ts";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { RunDot } from "../routines/index.ts";

const TONE: Partial<Record<RunInfo["status"], string>> = { failed: "text-deny", waiting: "text-wait" };

const ROW = "flex items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left outline-offset-2 outline-clay hover:border-line hover:bg-surface focus-visible:outline-2";

/** The small word after a run's name: its kind. A routine that starts a workflow says which, so `weekday-pr-digest` reads `workflow pr_digest`. */
function kindWords(run: RunInfo): string {
  return run.kind === "routine" && run.origin.startsWith("workflow:") ? `workflow ${run.origin.slice("workflow:".length)}` : run.kind;
}

/** Where a row goes: a workflow run opens its run page, any other run its session. A run with neither goes to the Runs page. */
export function runHref(run: RunInfo): string {
  if (run.workflow_run_id != null) return runPath(run.workflow_run_id);
  return run.session_id == null ? runsPath() : sessionPath(run.session_id);
}

type Picking = {
  /** The workflow run whose result is open beside the list, by its `workflow_run_id`. */
  selectedRun?: string | null;
  /** Called for a plain click on a workflow run. Without it a workflow run opens its page. */
  onSelectRun?: (workflowRunId: string) => void;
};

export type RunRowProps = Picking & { run: RunInfo; now: number; onNavigate: (path: string) => void };

/**
 * One run: its mark, name and kind, how it began, and on the right how it went and how long it took. Opens the session,
 * or for a workflow run its steps. A workflow run says what came out in one line under its name, and its state, start
 * and time on the right. With `onSelectRun`, a plain click on a workflow run picks it, so its result opens beside the
 * list; the link still goes to the run page for a new tab.
 */
export function RunRow({ run, now, onNavigate, selectedRun = null, onSelectRun }: RunRowProps) {
  const duration = runDuration(run, now);
  const workflowRun = run.workflow_run_id ?? null;
  const selected = workflowRun !== null && workflowRun === selectedRun;
  const tone = TONE[run.status] ?? "text-ink";
  // Where the line would only repeat the state on the right, a run says how many steps it has.
  const said = runResultLine(run);
  const name = (
    <span className="flex items-center gap-x-2">
      <span className="truncate text-sm font-medium">{runName(run)}</span>
      <span className="truncate text-meta text-faint">{kindWords(run)}</span>
    </span>
  );
  return (
    <li>
      <Link
        href={runHref(run)}
        onNavigate={workflowRun !== null && onSelectRun !== undefined ? () => onSelectRun(workflowRun) : onNavigate}
        aria-current={selected ? "true" : undefined}
        className={cn(ROW, selected && "border-line bg-surface")}
      >
        <span className="pt-1.5">
          <RunDot status={run.status} word={runStatusWords(run.status)} />
        </span>
        {workflowRun === null ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-y-0.5">
              {name}
              <span className="truncate text-meta text-muted">{runRowLine(run, now)}</span>
            </span>
            <span className="flex min-w-0 max-w-sm flex-col items-end gap-y-0.5 text-right">
              <span className={cn("max-w-full truncate text-sm", tone)}>{runResultLine(run)}</span>
              {duration === "" ? null : <span className="text-meta text-muted">{duration}</span>}
            </span>
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-y-0.5">
              {name}
              <span className={cn("truncate text-meta", TONE[run.status] ?? "text-muted")}>{said === runStatusWords(run.status) ? runStepsWords(run) : said}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-y-0.5 text-right">
              <span className={cn("text-sm", tone)}>{runStatusWords(run.status)}</span>
              <span className="text-meta text-muted">{[runStartedText(run, now), duration].filter((part) => part !== "").join(" · ")}</span>
            </span>
          </>
        )}
      </Link>
    </li>
  );
}

function Group({ group, now, onNavigate, selectedRun, onSelectRun }: Picking & { group: RunGroup<RunInfo>; now: number; onNavigate: (path: string) => void }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="px-3 text-meta font-normal text-faint">
        {runGroupHeading(group)}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {group.items.map((run) => (
          <RunRow key={runKey(run)} run={run} now={now} onNavigate={onNavigate} selectedRun={selectedRun} onSelectRun={onSelectRun} />
        ))}
      </ul>
    </div>
  );
}

export type RunsListProps = Picking & {
  /** The daemon's answer, or null while it has not come. */
  runs: readonly RunInfo[] | null;
  /** The reason the answer did not come, if it did not. */
  error?: string | null;
  now: number;
  onNavigate: (path: string) => void;
  /** What an empty list says when it is not "Nothing has run yet": a filter that matches nothing. */
  empty?: string;
};

/** The groups Needs you, Running, Today and Earlier, each run a row that opens its session. */
export function RunsList({ runs, error = null, now, onNavigate, selectedRun, onSelectRun, empty }: RunsListProps) {
  if (runs === null) {
    return <p className="text-sm text-muted">{error === null ? "Loading runs." : `Could not load runs. ${error}`}</p>;
  }
  if (runs.length === 0) {
    return <p className="text-sm text-muted">{empty ?? "Nothing has run yet. A routine's runs, and golem ask --detach, show here."}</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      {runGroups(runs, now).map((group) => (
        <Group key={group.label} group={group} now={now} onNavigate={onNavigate} selectedRun={selectedRun} onSelectRun={onSelectRun} />
      ))}
    </div>
  );
}
