import { needsYouElsewhere, runName, type RunLike } from "@golem/view";

/** The runs that wait for the person in another session, and the words about them. */
export type RunsSignal = {
  /** The number for the status line: every waiting run but this session's. */
  count: number;
  /** The newest waiting run the person has not dismissed, or null. */
  banner: { sessionId: string; text: string } | null;
};

/** The banner's words: `● sentry-triage needs you · /runs`. */
export function runsBannerText(run: RunLike): string {
  return `● ${runName(run)} needs you · /runs`;
}

/** The status segment: `runs: 2 waiting`, or "" at 0. */
export function runsWaitingLabel(count: number): string {
  return count > 0 ? `runs: ${count} waiting` : "";
}

/**
 * What the screen shows about runs waiting elsewhere. A dismissed session stays out of the banner,
 * but still counts in the status line. The banner shows one run at a time: the newest, and the next
 * one once that is dismissed or answered.
 */
export function runsSignal(
  runs: readonly RunLike[] | null,
  currentSessionId: string | null,
  dismissed: ReadonlySet<string>,
): RunsSignal {
  const waiting = needsYouElsewhere(runs ?? [], currentSessionId);
  const next = waiting.find((run) => !dismissed.has(run.session_id));
  return {
    count: waiting.length,
    banner: next === undefined ? null : { sessionId: next.session_id, text: runsBannerText(next) },
  };
}

/** The dismissed sessions that still wait: one that stopped waiting is forgotten, so it can show again. */
export function pruneDismissed(
  dismissed: ReadonlySet<string>,
  runs: readonly RunLike[] | null,
): ReadonlySet<string> {
  if (runs === null) {
    return dismissed;
  }
  const waiting = new Set(needsYouElsewhere(runs, null).map((run) => run.session_id));
  const kept = [...dismissed].filter((id) => waiting.has(id));
  return kept.length === dismissed.size ? dismissed : new Set(kept);
}
