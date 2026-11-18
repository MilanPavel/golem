import { approvalsWords, runBannerText } from "@golem/view";
import { routinePath, runsPath } from "../../store/router.ts";
import type { RunInfo } from "../../store/runs.ts";
import { Link } from "../../ui/link.tsx";
import { useNavigate, useSessionRun } from "../../store/page-context.tsx";
import { useNow } from "../sessions/use-now.ts";

const LINK = "text-clay-ink underline underline-offset-2 outline-offset-2 outline-clay focus-visible:outline-2";

export type RunBannerProps = {
  run: RunInfo;
  now: number;
  onNavigate: (path: string) => void;
  /** The region's name. A page has one banner, so the default is enough; a list of samples names each. */
  label?: string;
};

/**
 * The strip under a routine session's top bar: which routine started it, when, why, and what it waits
 * for, with links to the routine and to the list of runs. A detached ask has the list link only.
 */
export function RunBanner({ run, now, onNavigate, label = "Routine run" }: RunBannerProps) {
  const approvals = approvalsWords(run.approvals ?? 0);
  // The approvals part is a tone of its own, and the whole line is `runBannerText`.
  const line = runBannerText({ ...run, approvals: 0 }, now);
  return (
    <div role="region" aria-label={label} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-sunken px-4 py-2 text-sm">
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <span aria-hidden="true">⏱</span>
        <span className="min-w-0 wrap-anywhere">{line}</span>
        {approvals === "" ? null : <span className="text-wait">· {approvals}</span>}
      </span>
      {run.routine === null || run.routine === undefined ? null : (
        <Link href={routinePath(run.routine, run.folder)} onNavigate={onNavigate} className={LINK}>
          Routine settings
        </Link>
      )}
      <Link href={runsPath()} onNavigate={onNavigate} className={LINK}>
        All runs
      </Link>
    </div>
  );
}

/** The banner of a session on the live page: nothing for a chat of yours. */
export function LiveRunBanner({ sessionId }: { sessionId: string }) {
  const run = useSessionRun(sessionId);
  const navigate = useNavigate();
  const now = useNow();
  if (run === null || run === undefined) return null;
  return <RunBanner run={run} now={now} onNavigate={navigate} />;
}
