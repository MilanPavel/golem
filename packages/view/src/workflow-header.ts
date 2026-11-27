/**
 * The pills at the top of a workflow's page, in words: its routine, its last run, how many runs
 * it has, and its checks. Pure, so the web and the terminal say the same thing.
 */

import { routineHeadline, runStatusWords, type RoutineLike } from "./routines.ts";
import { runDuration, runStartedText, type RunLike } from "./runs.ts";

/** The Routine pill: the one routine ("Weekdays at 07:30 · next in 14 h"), a count for two or more, and for none that the workflow runs only when you press Run. */
export function routinePillWords(routines: readonly RoutineLike[], now: number): string {
  const [only, ...more] = routines;
  if (only === undefined) return "Not scheduled · it runs only when you press Run";
  return more.length === 0 ? routineHeadline(only, now) : `${routines.length} routines`;
}

/** The link that goes with a workflow that has no routine. */
export const ADD_ROUTINE_WORDS = "+ Add a routine";

/** The Last run pill: `finished today 11:22 · 47s`, `failed Yesterday 08:30`. A run with no start time gives its status alone. */
export function lastRunWords(run: RunLike, now: number): string {
  const started = runStartedText(run, now);
  const when = /^\d\d:\d\d$/.test(started) ? `today ${started}` : started;
  return [[runStatusWords(run.status), when].filter((part) => part !== "").join(" "), runDuration(run, now)].filter((part) => part !== "").join(" · ");
}

/** The All runs pill. */
export function allRunsWords(count: number): string {
  return count === 1 ? "1 run" : `All ${count} runs`;
}

/** The Checks pill: that they pass, or how many problems there are. */
export function checksWords(problems: number): string {
  return problems === 0 ? "checks pass" : problems === 1 ? "1 problem" : `${problems} problems`;
}
