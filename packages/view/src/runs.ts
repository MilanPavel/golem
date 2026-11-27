/**
 * The Runs list in words: which group a run is in, and the words of its row and of the banner a
 * routine's session shows. Pure and UI-neutral (no colours, no markup), so the web page and the
 * terminal's `/runs` say the same thing. The input is typed by its shape, as `run.list` sends it
 * (`RunInfo`), so this file does not depend on the generated types.
 *
 * A row is a headless session: a routine's firing, or a `golem ask --detach`. A workflow run (3.9)
 * is a row of another `kind` with a `steps` count and no `trigger`; the words here read `kind`,
 * never an id, and say what a missing field means.
 *
 * Times are local. Every function that says a time or a day takes `now` (milliseconds), so a test
 * and a ticking page agree.
 */

import { formatElapsed } from "./duration.ts";
import { lastResultText, runWhenText, type RoutineRunLike } from "./routines.ts";

/** The parts of a `RunInfo` these words read. Missing and null mean the same: not known. */
export type RunLike = {
  /** Null for a workflow run that has no session (a run gets one only when a step needs it). */
  session_id?: string | null;
  /** The workflow run's id, set for a workflow run. It is the row's key when `session_id` is not. */
  workflow_run_id?: string | null;
  /** The id of the workflow a workflow run is of. Missing for the other rows, and for a row an older daemon sent. */
  workflow_id?: string | null;
  /** `routine`, `ask` or `workflow`. */
  kind?: string;
  /** `workflow:<name>` for a workflow run. */
  origin?: string;
  routine?: string | null;
  trigger?: "schedule" | "watch" | "manual" | "hook" | null;
  status: RoutineRunLike["status"];
  started_at?: string | null;
  ended_at?: string | null;
  /** The question while the run waits, the last reply once it finished. */
  summary?: string | null;
  reason?: string | null;
  /** How many approvals the run waits for. */
  approvals?: number;
  /** The file a `watch` firing is for. */
  watch_path?: string | null;
  /** The steps of a workflow run. Null or missing for the other kinds. */
  steps?: number | null;
};

/** The row's stable key: a workflow run's id, else its session id. Never assume `session_id` is set. */
export function runKey(run: RunLike): string {
  const workflow = run.workflow_run_id;
  if (workflow !== undefined && workflow !== null && workflow !== "") return workflow;
  return run.session_id ?? "";
}

/** The groups, in the order the page shows them. */
export type RunGroupLabel = "Needs you" | "Running" | "Today" | "Earlier";

export interface RunGroup<T> {
  label: RunGroupLabel;
  items: T[];
}

const LABELS: readonly RunGroupLabel[] = ["Needs you", "Running", "Today", "Earlier"];

/** The name a `golem ask --detach` row goes by, since it has no routine. */
export const ASK_NAME = "golem ask";

function startOf(run: RunLike): number {
  const time = Date.parse(run.started_at ?? "");
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Whether a run needs the person: it is waiting for an answer. */
export function runNeedsYou(run: RunLike): boolean {
  return run.status === "waiting" || (run.approvals ?? 0) > 0;
}

/**
 * The runs in their groups, in this order, with empty groups left out:
 * - **Needs you**: waiting for an answer.
 * - **Running**: queued or running.
 * - **Today**: everything else that started on today's local date.
 * - **Earlier**: the rest, and a run with no readable start.
 *
 * Inside a group the newest start comes first, and equal starts keep their order. A start in the
 * future counts as today. The items are not copied or changed.
 */
export function runGroups<T extends RunLike>(runs: readonly T[], now: number): RunGroup<T>[] {
  const at = new Date(now);
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const buckets: T[][] = [[], [], [], []];
  for (const run of runs) {
    const index = runNeedsYou(run) ? 0 : run.status === "running" || run.status === "queued" ? 1 : startOf(run) >= today ? 2 : 3;
    buckets[index]!.push(run);
  }
  const groups: RunGroup<T>[] = [];
  LABELS.forEach((label, index) => {
    const items = buckets[index]!;
    if (items.length === 0) return;
    // Array.prototype.sort is stable. Compare instead of subtracting: two bad dates are both -Infinity.
    items.sort((a, b) => {
      const x = startOf(a);
      const y = startOf(b);
      return x === y ? 0 : y > x ? 1 : -1;
    });
    groups.push({ label, items });
  });
  return groups;
}

/** How many runs need the person: the number on the badge and in "Needs you (2)". */
export function needsYouCount(runs: readonly RunLike[]): number {
  return runs.filter(runNeedsYou).length;
}

/**
 * The runs that need the person, other than the session they are in, newest start first. The count
 * on the terminal's status line and its banner read this, so "waiting elsewhere" has one rule.
 */
export function needsYouElsewhere<T extends RunLike>(runs: readonly T[], currentSessionId: string | null): T[] {
  return runs
    .filter((run) => runNeedsYou(run) && run.session_id !== currentSessionId)
    .sort((a, b) => {
      const x = startOf(a);
      const y = startOf(b);
      return x === y ? 0 : y > x ? 1 : -1;
    });
}

/** A group's heading with its count: `Needs you (2)`. */
export function runGroupHeading(group: Pick<RunGroup<unknown>, "label" | "items">): string {
  return `${group.label} (${group.items.length})`;
}

/** A workflow's name from its id (`<path>::<name>`): what comes after the last `::`, or the whole id when it has none. */
export function workflowNameOfId(id: string): string {
  const at = id.lastIndexOf("::");
  return at < 0 ? id : id.slice(at + 2);
}

/**
 * The runs of one workflow, given its id. A row that carries its workflow's id is matched by it, so two workflows of
 * one name in two folders are told apart; a row that has none (a routine firing that started the workflow, or a row an
 * older daemon sent) says `workflow:<name>` in `origin` and is matched by the name. Order is kept.
 */
export function runsOfWorkflow<T extends RunLike>(runs: readonly T[], workflowId: string): T[] {
  const origin = `workflow:${workflowNameOfId(workflowId)}`;
  return runs.filter((run) => (run.workflow_id !== undefined && run.workflow_id !== null && run.workflow_id !== "" ? run.workflow_id === workflowId : run.origin === origin));
}

/** The row's name: the routine's, the workflow's, or `golem ask` for a detached ask. */
export function runName(run: RunLike): string {
  if (run.kind === "workflow" && run.origin?.startsWith("workflow:")) return run.origin.slice("workflow:".length);
  return run.routine ?? ASK_NAME;
}

function baseName(path: string): string {
  return path.split("/").filter((part) => part !== "").at(-1) ?? path;
}

/**
 * What started the run: `by schedule`, `by you` (run now), `by new file receipt-0412.pdf`, `by hook`,
 * and `from the CLI` for a detached ask. A run with no trigger and no routine, such as a workflow
 * run, gives an empty string and the page says its own words (its steps).
 */
export function runTriggerWords(run: RunLike): string {
  switch (run.trigger) {
    case "schedule":
      return "by schedule";
    case "manual":
      return "by you";
    case "hook":
      return "by hook";
    case "watch":
      return run.watch_path ? `by new file ${baseName(run.watch_path)}` : "by new file";
    default:
      return run.kind === "ask" || (run.kind === undefined && run.routine == null) ? "from the CLI" : "";
  }
}

const hhmm = (time: Date): string => `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;

/** When the run started: `08:30` today, else `Yesterday 08:30` or `Tue 10 Nov`. Empty when unreadable. */
export function runStartedText(run: RunLike, now: number): string {
  const iso = run.started_at;
  if (iso === null || iso === undefined) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const text = runWhenText(iso, now);
  return text.startsWith("Today ") ? hhmm(at) : text;
}

/** `1 step`, `4 steps`: what a workflow run shows where a routine run shows its trigger. Empty when there is no count. */
export function runStepsWords(run: RunLike): string {
  const steps = run.steps;
  return steps === null || steps === undefined ? "" : steps === 1 ? "1 step" : `${steps} steps`;
}

/**
 * The row's second line: the trigger (or, for a run that has none, its steps) and the start,
 * `by schedule · 10:00`. A part that is empty is left out.
 */
export function runRowLine(run: RunLike, now: number): string {
  const how = runTriggerWords(run);
  return [how === "" ? runStepsWords(run) : how, runStartedText(run, now)].filter((part) => part !== "").join(" · ");
}

/**
 * How long the run took, or has taken: `1m 04s`. A run that is running or waiting counts up to
 * `now`. A queued run says `queued`. A run without both times, and a skipped one, gives an empty string.
 */
export function runDuration(run: RunLike, now: number): string {
  if (run.status === "queued") return "queued";
  if (run.status === "skipped") return "";
  const start = Date.parse(run.started_at ?? "");
  if (Number.isNaN(start)) return "";
  const open = run.status === "running" || run.status === "waiting";
  const end = open ? now : Date.parse(run.ended_at ?? "");
  const ms = end - start;
  return Number.isNaN(ms) || ms < 0 ? "" : formatElapsed(ms);
}

function firstLine(text: string): string {
  return text.trim().split("\n", 1)[0]?.trim() ?? "";
}

/**
 * One line of how the run went, or of what it asks: the question while it waits (`Allow mcp__linear__create_issue`),
 * the start of the reply when it finished, the reason when it failed or was skipped, else the status words.
 */
export function runResultLine(run: RunLike): string {
  const summary = run.summary ? firstLine(run.summary) : "";
  if (run.status === "waiting" && summary !== "") return summary;
  return lastResultText({ status: run.status, reason: run.reason ?? null, summary: run.summary ?? null });
}

/** `1 approval waiting`, `2 approvals waiting`, and an empty string for none. */
export function approvalsWords(count: number): string {
  return count <= 0 ? "" : count === 1 ? "1 approval waiting" : `${count} approvals waiting`;
}

/**
 * The line of the banner a routine's session shows, from the same row as the list:
 * `Routine morning-brief · started 08:30 by schedule · 1 approval waiting`. A detached ask says
 * `golem ask · started 10:00 from the CLI`. The approvals part is left out when none wait.
 */
export function runBannerText(run: RunLike, now: number): string {
  const started = runStartedText(run, now);
  const head = run.kind === "ask" || run.routine == null ? runName(run) : `Routine ${run.routine}`;
  const how = [started === "" ? "" : `started ${started}`, runTriggerWords(run)].filter((part) => part !== "").join(" ");
  return [head, how, approvalsWords(run.approvals ?? 0)].filter((part) => part !== "").join(" · ");
}
