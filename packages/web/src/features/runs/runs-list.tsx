import { useId } from "react";
import { runDuration, runGroupHeading, runGroups, runKey, runName, runResultLine, runRowLine, runStatusWords, type RunGroup } from "@golem/view";
import { runPath, runsPath, sessionPath } from "../../store/router.ts";
import type { RunInfo } from "../../store/runs.ts";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { RunDot } from "../routines/index.ts";

const TONE: Partial<Record<RunInfo["status"], string>> = { failed: "text-deny", waiting: "text-wait" };

/** The small word after a run's name: its kind. A routine that starts a workflow says which, so `weekday-pr-digest` reads `workflow pr_digest`. */
function kindWords(run: RunInfo): string {
  return run.kind === "routine" && run.origin.startsWith("workflow:") ? `workflow ${run.origin.slice("workflow:".length)}` : run.kind;
}

/** Where a row goes: a workflow run opens its run page, any other run its session. A run with neither goes to the Runs page. */
export function runHref(run: RunInfo): string {
  if (run.workflow_run_id != null) return runPath(run.workflow_run_id);
  return run.session_id == null ? runsPath() : sessionPath(run.session_id);
}

/** One run: its mark, name and kind, how it began, and on the right how it went and how long it took. Opens the session, or for a workflow run its steps. */
export function RunRow({ run, now, onNavigate }: { run: RunInfo; now: number; onNavigate: (path: string) => void }) {
  const duration = runDuration(run, now);
  return (
    <li>
      <Link
        href={runHref(run)}
        onNavigate={onNavigate}
        className="flex items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left outline-offset-2 outline-clay hover:border-line hover:bg-surface focus-visible:outline-2"
      >
        <span className="pt-1.5">
          <RunDot status={run.status} word={runStatusWords(run.status)} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-y-0.5">
          <span className="flex items-center gap-x-2">
            <span className="truncate text-sm font-medium">{runName(run)}</span>
            <span className="truncate text-meta text-faint">{kindWords(run)}</span>
          </span>
          <span className="truncate text-meta text-muted">{runRowLine(run, now)}</span>
        </span>
        <span className="flex min-w-0 max-w-sm flex-col items-end gap-y-0.5 text-right">
          <span className={cn("max-w-full truncate text-sm", TONE[run.status] ?? "text-ink")}>{runResultLine(run)}</span>
          {duration === "" ? null : <span className="text-meta text-muted">{duration}</span>}
        </span>
      </Link>
    </li>
  );
}

function Group({ group, now, onNavigate }: { group: RunGroup<RunInfo>; now: number; onNavigate: (path: string) => void }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="px-3 text-meta font-normal text-faint">
        {runGroupHeading(group)}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {group.items.map((run) => (
          <RunRow key={runKey(run)} run={run} now={now} onNavigate={onNavigate} />
        ))}
      </ul>
    </section>
  );
}

export type RunsListProps = {
  /** The daemon's answer, or null while it has not come. */
  runs: readonly RunInfo[] | null;
  /** The reason the answer did not come, if it did not. */
  error?: string | null;
  now: number;
  onNavigate: (path: string) => void;
};

/** The groups Needs you, Running, Today and Earlier, each run a row that opens its session. */
export function RunsList({ runs, error = null, now, onNavigate }: RunsListProps) {
  if (runs === null) {
    return <p className="text-sm text-muted">{error === null ? "Loading runs." : `Could not load runs. ${error}`}</p>;
  }
  if (runs.length === 0) {
    return <p className="text-sm text-muted">Nothing has run yet. A routine&apos;s runs, and golem ask --detach, show here.</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      {runGroups(runs, now).map((group) => (
        <Group key={group.label} group={group} now={now} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
