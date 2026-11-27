import { formatElapsed } from "./duration.ts";
import type { CardTone } from "./helper-card.ts";
import { layoutSteps, type StepSpan, type StepsList } from "./steps-list.ts";

/**
 * A workflow run in words (3.9.3): its steps as the generic steps list takes them, the one line a step's
 * output is, the diff summary of a worker, and the draft of a review. Pure and UI-neutral, typed by
 * shape (`WorkflowStepInfo` as `workflow.status` sends it), so the page and the terminal say the same.
 */

/** The parts of a `WorkflowStepInfo` these words read. */
export type StepLike = {
  key: string;
  kind: string;
  title: string;
  /** The part that changes in a loop. */
  item?: string | null;
  status: string;
  error?: string | null;
  child_session_id?: string | null;
  model?: string | null;
  cost_usd?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  result?: unknown;
  /** The one-line form of the result, as the daemon sends it: used when the result itself was too large for an event. */
  line?: string | null;
  /** How many steps of this title the workflow said it has in all (`run.step(of=)`), when it did. */
  of?: number | null;
  /** The text so far of a running step that sends progress. */
  progress?: string | null;
  /** The run this step's result was taken from, when its run started again from a step. */
  reused_from?: string | null;
};

const STEP_WORDS: Record<string, string> = {
  pending: "not started",
  running: "running",
  waiting: "waiting for you",
  done: "done",
  failed: "failed",
  skipped: "skipped",
  in_doubt: "in doubt",
};

const STEP_TONES: Record<string, CardTone> = { running: "run", done: "ok", failed: "bad", in_doubt: "wait", waiting: "wait" };

/** The state of a step as a word. */
export function stepWords(status: string): string {
  return STEP_WORDS[status] ?? status;
}

function parseTs(ts: string | null | undefined): number | null {
  if (ts === null || ts === undefined) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/** The title, then the item when the step has one: `Check folder · golem`. */
export function stepLabel(step: Pick<StepLike, "title" | "item">): string {
  return step.item === null || step.item === undefined || step.item === "" ? step.title : `${step.title} · ${step.item}`;
}

/**
 * The steps as spans for `layoutSteps`. A step that never started begins at `nowMs`; one that is
 * running or waiting has no end, so it runs to "now". A step that waits for you is `you` from its start.
 */
export function workflowStepSpans(steps: readonly StepLike[], nowMs: number): StepSpan[] {
  return steps.map((step): StepSpan => {
    const startMs = parseTs(step.started_at) ?? nowMs;
    const finished = parseTs(step.finished_at);
    const open = step.status === "running" || step.status === "waiting";
    const endMs = open ? null : (finished ?? startMs);
    return {
      id: step.key,
      label: stepLabel(step),
      role: "helper",
      startMs,
      endMs,
      marks: step.status === "waiting" ? [{ atMs: startMs, kind: "you" }] : [],
      right: stepWords(step.status),
      tone: STEP_TONES[step.status] ?? "run",
    };
  });
}

/** The steps list of a run, bars on one scale. */
export function workflowStepsList(steps: readonly StepLike[], nowMs: number): StepsList {
  return layoutSteps(workflowStepSpans(steps, nowMs), nowMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a writing agent's step returns: its copy, its diff and its checks. */
export type WorkerResult = { worktree: string; diff: string | null; files: number; added: number; removed: number; checks: string; checksNote: string | null };

/** A worker step's result, read by its keys. Null for any other result. */
export function workerResult(result: unknown): WorkerResult | null {
  if (!isRecord(result)) return null;
  const { worktree, files } = result;
  if (typeof worktree !== "string" || !Array.isArray(files)) return null;
  const num = (value: unknown): number => (typeof value === "number" ? value : 0);
  return {
    worktree,
    diff: typeof result["diff"] === "string" ? result["diff"] : null,
    files: files.length,
    added: num(result["added"]),
    removed: num(result["removed"]),
    checks: typeof result["checks"] === "string" ? result["checks"] : "none",
    checksNote: typeof result["checks_note"] === "string" && result["checks_note"] !== "" ? result["checks_note"] : null,
  };
}

/** `3 files · +12 −4 · checks passed`: what a worker changed. */
export function workerLine(worker: WorkerResult): string {
  const files = `${worker.files} ${worker.files === 1 ? "file" : "files"}`;
  const checks = worker.checks === "none" ? "no checks" : `checks ${worker.checks}`;
  return `${files} · +${worker.added} −${worker.removed} · ${checks}`;
}

function oneLine(text: string, size: number): string {
  const line = text
    .split(/\s+/)
    .filter((word) => word !== "")
    .join(" ");
  return line.length <= size ? line : `${line.slice(0, size - 1).trimEnd()}…`;
}

const VERDICT_WORDS: Record<string, string> = { approve: "approved", edit: "edited and approved", reject: "rejected" };

/** The shapes a step's result comes in, which decide how it is drawn and what its one line says. */
export type ResultKind = "text" | "record" | "table" | "file" | "link" | "changes" | "empty" | "other";

/** What an empty result says. */
export const EMPTY_RESULT_WORDS = "Nothing found";

const LINK_PATTERN = /^https?:\/\/\S+$/;
const FILE_PATTERN = /^(\/|~\/)[^\n]*$/;

/** The shape of a saved result: text, a record, a table (a list of records), a file path, a link, a worker's changes, nothing, or other. */
export function resultKind(value: unknown): ResultKind {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return "empty";
    if (LINK_PATTERN.test(text)) return "link";
    return FILE_PATTERN.test(text) ? "file" : "text";
  }
  if (Array.isArray(value)) return value.length === 0 ? "empty" : value.every(isRecord) ? "table" : "other";
  if (isRecord(value)) {
    if (Object.keys(value).length === 0) return "empty";
    return workerResult(value) === null ? "record" : "changes";
  }
  return "other";
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** `branch main · files 3`: up to three scalar fields of a record, key then value. Empty when it has none. */
function recordPairs(record: Record<string, unknown>): string {
  return Object.entries(record)
    .filter((entry): entry is [string, string | number | boolean] => isScalar(entry[1]))
    .slice(0, 3)
    .map(([key, value]) => `${key} ${oneLine(String(value), 30)}`)
    .join(" · ");
}

/** The one line a step's saved result is, in words by its kind. Empty when there is no result at all. */
export function stepOutputLine(step: Pick<StepLike, "kind" | "result" | "line">): string {
  const { result } = step;
  if (result === null || result === undefined) return step.line ?? "";
  const kind = resultKind(result);
  if (kind === "empty") return EMPTY_RESULT_WORDS;
  if (typeof result === "string") return oneLine(result, 120);
  if (Array.isArray(result) && kind === "table") return `${result.length} ${result.length === 1 ? "row" : "rows"}`;
  const worker = workerResult(result);
  if (worker !== null) return workerLine(worker);
  if (isRecord(result)) {
    const verdict = result["verdict"];
    if (step.kind === "review" && typeof verdict === "string") {
      const text = result["text"];
      return `${VERDICT_WORDS[verdict] ?? verdict}${typeof text === "string" && text !== "" && verdict !== "approve" ? ` · ${oneLine(text, 80)}` : ""}`;
    }
    const summary = result["summary"];
    if (typeof summary === "string") return oneLine(summary, 120);
    const pairs = recordPairs(result);
    if (pairs !== "") return pairs;
    const count = Object.keys(result).length;
    return `${count} ${count === 1 ? "field" : "fields"}`;
  }
  return oneLine(JSON.stringify(result), 120);
}

/** The whole saved result as text: a string as it is, anything else as indented JSON. */
export function stepOutputText(result: unknown): string {
  if (result === null || result === undefined) return "";
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

/** What Copy puts on the clipboard for a result: the text, the path of a file, the address of a link, or a record or table as JSON. */
export function resultCopyText(result: unknown): string {
  if (typeof result === "string") return result.trim();
  return stepOutputText(result);
}

/** What "Ask about this" starts a new chat with: where the result is from, then the result (text quoted, a file as its path, data as JSON), and room for the question. */
export function askAboutResult(title: string, result: unknown): string {
  const kind = resultKind(result);
  const text = resultCopyText(result);
  const fence = "```";
  const body = kind === "text" ? text.split("\n").map((line) => (line === "" ? ">" : `> ${line}`)).join("\n") : kind === "file" || kind === "link" ? text : `${fence}json\n${text}\n${fence}`;
  const what = kind === "file" ? "the file" : "this";
  return `About ${what} from the result "${title}":\n\n${body}\n\n`;
}

/** `llm · deepseek/chat · $0.02`: the kind of a step, and its model and cost when it has them. */
export function stepMetaLine(step: Pick<StepLike, "kind" | "model" | "cost_usd">): string {
  const parts: string[] = [step.kind];
  if (step.model !== null && step.model !== undefined && step.model !== "") parts.push(step.model);
  const cost = step.cost_usd;
  if (cost !== null && cost !== undefined) parts.push(cost === 0 ? "$0" : `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`);
  return parts.join(" · ");
}

/** A review's draft as text, as the daemon reads it: a string as it is, anything else as JSON. */
export function reviewDraftText(draft: unknown): string {
  if (draft === null || draft === undefined) return "";
  return typeof draft === "string" ? draft : JSON.stringify(draft, null, 2);
}

/** A `run.tool` ask: the tool, its arguments and what made it ask. */
export type ToolAsk = { tool: string; args: unknown; source: string | null };

/** The tool ask of a review's draft, which is `{tool, args, source}`. Null for any other draft. */
export function toolAsk(draft: unknown): ToolAsk | null {
  if (!isRecord(draft) || typeof draft["tool"] !== "string" || !("args" in draft)) return null;
  return { tool: draft["tool"], args: draft["args"], source: typeof draft["source"] === "string" ? draft["source"] : null };
}

/** The title of a review card: the ask, or "Run <tool>?" for a tool ask. */
export function reviewTitle(review: { ask: string; draft?: unknown }): string {
  const ask = toolAsk(review.draft);
  return ask === null ? review.ask : `Run ${ask.tool}?`;
}

/** The time a run took, from its start to its end or "now". Empty before it starts. */
export function workflowRunTook(run: { started_at?: string | null; finished_at?: string | null }, nowMs: number): string {
  const start = parseTs(run.started_at);
  if (start === null) return "";
  return formatElapsed(Math.max(0, (parseTs(run.finished_at) ?? nowMs) - start));
}

/** A time on the run page: `<1s`, `47s`, `2m 05s`. Empty when the number is not a duration. */
export function shortTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return "<1s";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** How long a step took, or has taken so far when it is still going. Empty for a step that has not started. */
export function stepTook(step: Pick<StepLike, "started_at" | "finished_at" | "status">, nowMs: number): string {
  const start = parseTs(step.started_at);
  if (start === null) return "";
  const open = step.status === "running" || step.status === "waiting";
  const end = open ? nowMs : (parseTs(step.finished_at) ?? start);
  return shortTime(Math.max(0, end - start));
}

/** One row of the run page's step list: a step on its own, or the steps that share one title, folded into one row. */
export type RunStepRow<T extends StepLike = StepLike> = { kind: "step"; step: T } | { kind: "repeat"; title: string; items: T[]; state: string; done: number; total: number | null };

/** The state of a folded row: failed if any item failed, working if any is going, done when all are, else not started. */
function repeatState(items: readonly StepLike[]): string {
  if (items.some((item) => item.status === "failed" || item.status === "in_doubt")) return "failed";
  if (items.some((item) => item.status === "running")) return "running";
  if (items.some((item) => item.status === "waiting")) return "waiting";
  if (items.every((item) => item.status === "pending")) return "pending";
  return items.every((item) => item.status === "done" || item.status === "skipped") ? "done" : "running";
}

/**
 * The steps of a run as rows. Steps with an `item` and the same title fold into one row at the place of the
 * first, so a loop of 30 is one row as a loop of 3 is. A step with no item is a row of its own.
 */
export function foldSteps<T extends StepLike>(steps: readonly T[]): RunStepRow<T>[] {
  const rows: RunStepRow<T>[] = [];
  const folds = new Map<string, Extract<RunStepRow<T>, { kind: "repeat" }>>();
  for (const step of steps) {
    if (step.item === null || step.item === undefined || step.item === "") {
      rows.push({ kind: "step", step });
      continue;
    }
    let fold = folds.get(step.title);
    if (fold === undefined) {
      fold = { kind: "repeat", title: step.title, items: [], state: "pending", done: 0, total: null };
      folds.set(step.title, fold);
      rows.push(fold);
    }
    fold.items.push(step);
  }
  for (const fold of folds.values()) {
    fold.state = repeatState(fold.items);
    fold.done = fold.items.filter((item) => item.status === "done" || item.status === "skipped").length;
    // The total is what the workflow said, never fewer than the steps already seen; with no word from it there is none.
    const said = Math.max(0, ...fold.items.map((item) => item.of ?? 0));
    fold.total = said > 0 ? Math.max(said, fold.items.length) : null;
  }
  return rows;
}

/** The state of a row: a step's own, or a folded row's. */
export function stepRowState(row: RunStepRow): string {
  return row.kind === "step" ? row.step.status : row.state;
}

/** What `stepsProgress` knows about the run's size. */
export type ProgressOptions = {
  /** The run goes on: its list of steps may still grow. */
  live?: boolean;
  /** How many steps the daemon expects the run to have (`steps_expected`), when it can say. */
  expected?: number | null;
};

/**
 * The rows finished, and the title of the one that works now. A run that is over has the rows it has as its total. While it
 * goes, the total is what the daemon expects, when it can say and the rows seen do not pass it ("5 of 7 steps"); else there is
 * none: the words count the rows so far ("5 steps so far") and `known` is false, so the bar is indeterminate. A total is never made up.
 */
export function stepsProgress(rows: readonly RunStepRow[], options: ProgressOptions = {}): { done: number; total: number; known: boolean; current: string | null; words: string } {
  const finished = (row: RunStepRow) => ["done", "skipped"].includes(stepRowState(row));
  const done = rows.filter(finished).length;
  const now = rows.find((row) => ["running", "waiting", "failed", "in_doubt"].includes(stepRowState(row)));
  const current = now === undefined ? null : now.kind === "step" ? now.step.title : now.title;
  const noun = (count: number) => (count === 1 ? "step" : "steps");
  const { live = false, expected = null } = options;
  if (!live) return { done, total: rows.length, known: true, current, words: `${done} of ${rows.length} ${noun(rows.length)}` };
  if (expected !== null && expected >= rows.length && expected > 0) return { done, total: expected, known: true, current, words: `${done} of ${expected} ${noun(expected)}` };
  return { done, total: rows.length, known: false, current, words: `${rows.length} ${noun(rows.length)} so far` };
}

/** The count of a repeating row: "12 of 30" when the workflow said the total, else the ones finished "12 so far" while it goes, and "12 of 14" once it is over. */
export function repeatCount(row: Extract<RunStepRow, { kind: "repeat" }>): string {
  if (row.total !== null) return `${row.done} of ${row.total}`;
  return ["done", "failed"].includes(row.state) ? `${row.done} of ${row.items.length}` : `${row.done} so far`;
}

/** One thing that works now: what it is in words, and how long it has gone. */
export type LiveLine = { key: string; text: string; took: string };

/**
 * What runs now, one line each: a step is its title and item ("Reading feed · example.com/rss"), an item of a repeating step
 * says its place when the total is known ("Reading feed 12 of 30 · example.com/rss"). Steps that go at once (a parallel group)
 * are each a line, in the order they started.
 */
export function liveLines(rows: readonly RunStepRow[], nowMs: number): LiveLine[] {
  const lines: LiveLine[] = [];
  for (const row of rows) {
    const items = row.kind === "step" ? [row.step] : row.items;
    items.forEach((step, at) => {
      if (step.status !== "running") return;
      const place = row.kind === "repeat" && row.total !== null ? ` ${at + 1} of ${row.total}` : "";
      const item = step.item === null || step.item === undefined || step.item === "" ? "" : ` \u00b7 ${step.item}`;
      lines.push({ key: step.key, text: `${step.title}${place}${item}`, took: stepTook(step, nowMs) });
    });
  }
  return lines;
}

/** The steps that did something worth telling when the run marked no result: a notice sent, a review answered, a tool called. */
export function whatItDid<T extends StepLike>(steps: readonly T[]): T[] {
  return steps.filter((step) => (step.kind === "notify" || step.kind === "review" || step.kind === "tool") && step.status === "done" && step.result !== null && step.result !== undefined);
}

/** "usually about 45s": how long a run of the workflow usually takes. Empty when the daemon has no usual time yet (fewer than two runs finished). */
export function usualWords(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `usually about ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `usually about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `usually about ${hours}h${minutes % 60 === 0 ? "" : ` ${minutes % 60} min`}`;
}

/** One finished thing a running run has found: what it is and its one line. */
export type Found = { key: string; label: string; line: string };

/**
 * What a run has found so far, in the order it found it: the one line of each step that is done and has a result, a repeating
 * row as one line with its count ("Reading feed", "12 of 30").
 */
export function foundSoFar(rows: readonly RunStepRow[]): Found[] {
  const found: Found[] = [];
  for (const row of rows) {
    if (row.kind === "repeat") {
      if (row.done > 0) found.push({ key: `repeat:${row.title}`, label: row.title, line: repeatCount(row) });
      continue;
    }
    const line = row.step.status === "done" ? stepOutputLine(row.step) : "";
    if (line !== "") found.push({ key: row.step.key, label: stepLabel(row.step), line });
  }
  return found;
}

/** The text of a running step as it comes. */
export type LiveText = { key: string; label: string; text: string };

/** The running steps that send progress text, in the order they started. A step that is not running has none to show. */
export function liveTexts(steps: readonly StepLike[]): LiveText[] {
  return steps
    .filter((step) => step.status === "running" && step.progress !== null && step.progress !== undefined && step.progress !== "")
    .map((step) => ({ key: step.key, label: stepLabel(step), text: step.progress ?? "" }));
}

/** The action on a step of a run that is over. */
export const RUN_AGAIN_WORDS = "Run again from here";

/** Where a run started again from a step came from, as `workflow.status` sends it. */
export type RunOrigin = { started_at?: string | null; step_title: string; step_number: number };

/** The line a run started again says about where it came from: `Run again from step 2 of the run of 26 Nov, 08:00`. */
export function runAgainFromWords(origin: RunOrigin, when: string): string {
  return `Run again from step ${origin.step_number} of the run of ${when}`;
}

/** The mark of a step whose result was taken from the older run. */
export function reusedWords(when: string): string {
  return `from the run of ${when}`;
}

/** The one line of what a run started again reused and what ran again; the reused steps carry `reused_from`. */
export function reuseNote(origin: Pick<RunOrigin, "step_title">, steps: readonly { reused_from?: string | null }[], when: string): string {
  const reused = steps.filter((step) => step.reused_from !== null && step.reused_from !== undefined).length;
  const again = steps.length - reused;
  const kept = reused === 0 ? "No step was taken from" : `${reused} ${reused === 1 ? "step was" : "steps were"} taken from`;
  const ran = again <= 1 ? `${origin.step_title} ran again` : `${origin.step_title} and ${again - 1} ${again - 1 === 1 ? "step" : "steps"} after it ran again`;
  return `${kept} the run of ${when}; ${ran}.`;
}
