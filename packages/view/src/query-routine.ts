/**
 * The routine a saved query makes (the Routine dialog of the Queries tab), as words and as the fields
 * `routine.update` takes. Pure, so the web and the terminal say the same thing.
 */

import { DEFAULT_WHEN, whenToSchedule, watchToOn, type RoutineConfigLike, type RoutineWhen } from "./routines.ts";

/** When the dialog offers to run: the same kinds as the routine builder, with "every hour" as its own line. */
export type QueryWhenKind = "hour" | "daily" | "weekdays" | "weekly" | "watch" | "cron";

export const QUERY_WHEN_KINDS: readonly { kind: QueryWhenKind; label: string }[] = [
  { kind: "hour", label: "Every hour" },
  { kind: "daily", label: "Every day at…" },
  { kind: "weekdays", label: "Weekdays at…" },
  { kind: "weekly", label: "Every week on…" },
  { kind: "watch", label: "When a new file lands in the source's folder" },
  { kind: "cron", label: "Custom (cron)" },
];

/** What happens when it runs: post the result, post only rows, or have a model write a summary. */
export type QueryThen = "always" | "rows" | "summary";

export const QUERY_THEN: readonly { value: QueryThen; label: string; hint: string }[] = [
  { value: "always", label: "Post the result to the Inbox", hint: "Every time, with the first rows." },
  {
    value: "rows",
    label: "Post only when it finds rows",
    hint: "An alert: put the threshold in the query, such as where amount < -500 or having count(*) > 5.",
  },
  {
    value: "summary",
    label: "Ask a model to write a summary",
    hint: "Starts the data report workflow with this query. Only that one step uses a model.",
  },
];

/** The workflow "Ask a model to write a summary" starts. */
export const DATA_REPORT_WORKFLOW = "data_report";

/** The line under the choices: the Inbox is local, and a phone gets no rows. */
export const QUERY_ROUTINE_PRIVACY =
  "The Inbox is on this Mac, so it shows the rows whatever the source's privacy. A push to your phone says only the name and the row count.";

/** The default routine name for a saved query: lower case, words joined with dashes, at most 40 characters. */
export function routineNameOf(saved: string): string {
  const base = saved
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base === "" ? "query" : base;
}

/** The builder fields of a dialog choice: "hour" is every 1 hour. */
export function whenOfQuery(kind: QueryWhenKind, time: string, day: number, cron: string): RoutineWhen {
  if (kind === "hour") return { ...DEFAULT_WHEN, kind: "hours", hours: "1" };
  if (kind === "watch") return { ...DEFAULT_WHEN, kind: "watch" };
  return { ...DEFAULT_WHEN, kind, time, day, cron };
}

/**
 * The fields of `routine.update` for the dialog, or null while the When is not filled in (a time that does not read,
 * empty cron, or no folder for a new file). "summary" writes the data report workflow with the source and the
 * query as its inputs.
 */
export function queryRoutineFields(input: {
  source: string;
  saved: string;
  when: RoutineWhen;
  then: QueryThen;
  folder?: string;
  glob?: string;
}): Partial<RoutineConfigLike> | null {
  const trigger: Partial<RoutineConfigLike> = {};
  if (input.when.kind === "watch") {
    const on = watchToOn(input.folder ?? "", input.glob ?? "");
    if (on === null) return null;
    trigger.on = on;
  } else {
    const schedule = whenToSchedule(input.when);
    if (schedule === null) return null;
    trigger.schedule = schedule;
  }
  if (input.then === "summary") {
    return { ...trigger, workflow: DATA_REPORT_WORKFLOW, inputs: { source: input.source, queries: input.saved } };
  }
  return { ...trigger, query: { source: input.source, saved: input.saved }, post: input.then };
}

/** The chip on a query's row: "⏱ every hour · only when it finds rows". Without the routine's own words, a routine that is not a query of this source gives null. */
export function routineChipText(config: RoutineConfigLike, whenWords: string): string {
  const then = config.workflow !== undefined && config.workflow !== null ? "a model writes a summary" : config.post === "rows" ? "only when it finds rows" : "";
  return then === "" ? `⏱ ${whenWords}` : `⏱ ${whenWords} · ${then}`;
}

/** Whether a routine runs this saved query: a query routine, or a data report with it in its queries. */
export function routineRunsQuery(config: RoutineConfigLike, source: string, saved: string): boolean {
  if (config.query) return config.query.source === source && config.query.saved === saved;
  if (config.workflow === DATA_REPORT_WORKFLOW) {
    const names = String(config.inputs?.["queries"] ?? "")
      .split("\n")
      .map((name) => name.trim());
    return config.inputs?.["source"] === source && names.includes(saved);
  }
  return false;
}

/** The parts of an Inbox post these words read. */
export type InboxPostLike = {
  routine: string;
  source: string;
  saved: string;
  row_count: number;
  error?: string | null | undefined;
  at: string;
};

/** The line after the routine's name on a post: "2 rows · bank", or "could not run · bank". */
export function inboxPostMeta(post: InboxPostLike): string {
  const what = post.error ? "could not run" : post.row_count === 1 ? "1 row" : `${String(post.row_count)} rows`;
  return `${what} · ${post.source}`;
}

/** The note under the rows of a post that has more than it shows, or null. */
export function inboxPostMore(post: Pick<InboxPostLike, "row_count">, shown: number): string | null {
  return post.row_count > shown ? `… ${String(post.row_count - shown)} more in the query` : null;
}

/** The time of a post, "10:00" in local time. Empty when the time does not read. */
export function inboxPostTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The draft "Ask in chat" opens a chat with, from a post. */
export function askAboutPostText(post: InboxPostLike): string {
  if (post.error) return `The routine ${post.routine} could not run "${post.saved}" on @${post.source}: ${post.error}\n\nHelp me fix it.`;
  const rows = post.row_count === 1 ? "1 row" : `${String(post.row_count)} rows`;
  return `The routine ${post.routine} ran "${post.saved}" on @${post.source} and found ${rows}. Run it again and tell me what stands out.`;
}

/** The folder and glob of a files source, from its location: `~/Documents/bank/*.csv` is the folder `~/Documents/bank` and `*.csv`. A folder is all its files. Null when there is no location. */
export function watchOfLocation(location: string | null | undefined): { folder: string; glob: string } | null {
  const text = (location ?? "").trim();
  if (text === "") return null;
  const slash = text.lastIndexOf("/");
  const last = slash === -1 ? text : text.slice(slash + 1);
  if (/[*?[]/.test(last)) return { folder: slash <= 0 ? "/" : text.slice(0, slash), glob: last };
  return { folder: text.replace(/\/+$/, "") || "/", glob: "*" };
}
