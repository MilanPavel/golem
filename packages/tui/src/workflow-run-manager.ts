import type { WorkflowStatusResult } from "@golem/client";
import {
  EMPTY_RESULT_WORDS,
  foldSteps,
  groupWords,
  liveLines,
  liveTexts,
  repeatCount,
  resultKind,
  reviewDraftText,
  reviewTitle,
  stepLabel,
  stepMetaLine,
  stepOutputLine,
  stepOutputText,
  stepsProgress,
  stepWords,
  usualWords,
  whatItDid,
  workerResult,
  workerLine,
  workflowRunTook,
  workflowRunWords,
  type RunStepRow,
} from "@golem/view";

import type { Press } from "./keys.ts";
import { markdownLines } from "./layout-chat.ts";
import type { McpManagerLine, McpTone } from "./mcp-manager.ts";
import { REVIEW_KEYS } from "./review.ts";

/**
 * A workflow run, full screen (3.9.4): one line per step with its mark, time and result, the selected step
 * unfolded (its helper session, a worker's copy and checks, its output), the review the run waits on, and the
 * keys to answer it, cancel the run or resume it. Pure: the app holds the `workflow.status` answer and fetches it
 * again on every `workflow.run.*` and `workflow.step.*` notification.
 */

export type WorkflowRunInfo = WorkflowStatusResult["run"];
export type WorkflowStepInfo = NonNullable<WorkflowStatusResult["steps"]>[number];
export type WorkflowReviewInfo = NonNullable<WorkflowStatusResult["reviews"]>[number];

/** The run as the daemon last said it, or why it could not. */
export type WorkflowRunData = { status: WorkflowStatusResult | null; error: string | null };

export type WorkflowRunManagerState = {
  open: boolean;
  workflowRunId: string;
  selected: number;
  /** What the last key said, such as why Resume does nothing. Cleared by the next key. */
  notice: string | null;
  /** The titles of the repeating rows that are opened, each showing its items. */
  unfolded: readonly string[];
  /** The screen Esc goes back to. */
  from: "runs" | "workflows" | "other";
};

export const closedWorkflowRun: WorkflowRunManagerState = { open: false, workflowRunId: "", selected: 0, notice: null, unfolded: [], from: "other" };

export function openWorkflowRun(workflowRunId: string, from: WorkflowRunManagerState["from"] = "other"): WorkflowRunManagerState {
  return { open: true, workflowRunId, selected: 0, notice: null, unfolded: [], from };
}

/** One result a run marked, or, with none marked, what the run returned (`index` is null). `index` is the place in `outputs`. */
export type RunOutput = { index: number | null; title: string; summary: string | null; value: unknown };

/** The results of a run in order, as the web page lists them. A run that marked none shows its return value when it has one. */
export function runOutputs(run: Pick<WorkflowRunInfo, "outputs" | "result">): RunOutput[] {
  const marked = run.outputs ?? [];
  const many = marked.length > 1;
  const shown = marked.map((output, index): RunOutput => ({ index, title: output.title ?? (many ? `Result ${index + 1}` : "Result"), summary: output.summary ?? null, value: output.value }));
  const nonEmpty = shown.filter((output) => resultKind(output.value) !== "empty");
  if (nonEmpty.length > 0) return nonEmpty;
  return resultKind(run.result) === "empty" ? [] : [{ index: null, title: "Result", summary: null, value: run.result }];
}

/** What `r` shows: the marked results, or, for a done run that marked none, what its notice, review and tool steps did. */
function resultOutputs(status: WorkflowStatusResult): RunOutput[] {
  const outputs = runOutputs(status.run);
  if (outputs.length > 0 || status.run.status !== "done") return outputs;
  const did = whatItDid(status.steps ?? []);
  return did.length === 0 ? [] : [{ index: null, title: "What it did", summary: null, value: did.map((step) => `- ${stepLabel(step)}: ${stepOutputLine(step)}`).join("\n") }];
}

export type WorkflowRunKey = "up" | "down" | "enter" | "back" | "approve" | "reply" | "reject" | "cancel" | "resume";

export type WorkflowRunAction =
  | { kind: "none" }
  | { kind: "close"; from: WorkflowRunManagerState["from"] }
  /** Open a step's helper session as a chat. */
  | { kind: "open-chat"; sessionId: string }
  /** Open the run's own session, where the review band takes the edit. */
  | { kind: "open-review"; sessionId: string }
  | { kind: "answer"; key: string; verdict: "approve" | "reject" }
  /** `r` with no review waiting: the result in the pager. The app reads a file output (`workflow.read_output`) first. */
  | { kind: "show-result"; outputs: RunOutput[] }
  | { kind: "cancel" }
  | { kind: "resume" };

export function workflowRunKeyOf(press: Press): WorkflowRunKey | null {
  if (press.name === "up" || press.name === "down") return press.name;
  if (press.name === "return") return "enter";
  if (press.name === "escape") return "back";
  if (press.name !== null || press.ctrl || press.meta) return null;
  switch (press.input) {
    case "y":
      return "approve";
    case "r":
      return "reply";
    case "n":
      return "reject";
    case "c":
      return "cancel";
    case "s":
      return "resume";
    default:
      return null;
  }
}

/** A run that can still be stopped. */
export function runIsLive(run: Pick<WorkflowRunInfo, "status">): boolean {
  return run.status === "running" || run.status === "waiting" || run.status === "pending";
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, count - 1));
}

const NONE: WorkflowRunAction = { kind: "none" };

export function pressWorkflowRun(
  state: WorkflowRunManagerState,
  data: WorkflowRunData,
  key: WorkflowRunKey,
): { state: WorkflowRunManagerState; action: WorkflowRunAction } {
  if (key === "back") return { state: closedWorkflowRun, action: { kind: "close", from: state.from } };
  const cleared = { ...state, notice: null };
  const status = data.status;
  if (status === null) return { state: cleared, action: NONE };
  const rows = foldSteps(status.steps ?? []);
  const say = (notice: string) => ({ state: { ...state, notice }, action: NONE });
  if (key === "up" || key === "down") return { state: { ...cleared, selected: clamp(state.selected + (key === "up" ? -1 : 1), rows.length) }, action: NONE };
  if (key === "enter") {
    const row = rows[clamp(state.selected, rows.length)];
    if (row?.kind === "repeat") {
      const open = state.unfolded.includes(row.title);
      return { state: { ...cleared, unfolded: open ? state.unfolded.filter((title) => title !== row.title) : [...state.unfolded, row.title] }, action: NONE };
    }
    const child = row?.step.child_session_id;
    return child === null || child === undefined ? say("This step has no helper session to open.") : { state: cleared, action: { kind: "open-chat", sessionId: child } };
  }
  const review = status.reviews?.[0];
  if (key === "approve" || key === "reject") {
    if (review === undefined) return say("No review waits on this run.");
    return { state: cleared, action: { kind: "answer", key: review.key, verdict: key === "approve" ? "approve" : "reject" } };
  }
  if (key === "reply") {
    if (review === undefined) {
      const shown = resultOutputs(status);
      if (shown.length > 0) return { state: cleared, action: { kind: "show-result", outputs: shown } };
      return say(runIsLive(status.run) ? "No result yet. It shows here when the run has one." : EMPTY_RESULT_WORDS);
    }
    const session = status.run.session_id;
    return session === null || session === undefined ? say("This run has no session to edit the draft in.") : { state: cleared, action: { kind: "open-review", sessionId: session } };
  }
  if (key === "cancel") return runIsLive(status.run) ? { state: cleared, action: { kind: "cancel" } } : say("The run has ended already.");
  return status.run.status === "failed" ? { state: cleared, action: { kind: "resume" } } : say("Only a run that failed resumes.");
}

/** The steps a notification changed, folded into the status without a second `workflow.status`. */
export function applyStepNotice(data: WorkflowRunData, step: WorkflowStepInfo & { workflow_run_id: string }): WorkflowRunData {
  if (data.status === null || data.status.run.workflow_run_id !== step.workflow_run_id) return data;
  const info: WorkflowStepInfo & { workflow_run_id?: string } = { ...step };
  delete info.workflow_run_id;
  const steps = data.status.steps ?? [];
  const at = steps.findIndex((item) => item.key === info.key);
  const next = at < 0 ? [...steps, info] : steps.map((item, index) => (index === at ? { ...item, ...info } : item));
  return { ...data, status: { ...data.status, steps: next } };
}

/** ○ not started, ● running, ! waits for you, ✔ done, ✘ failed. */
export function stepMark(status: string): { text: string; tone: McpTone } {
  switch (status) {
    case "running":
      return { text: "●", tone: "ok" };
    case "waiting":
    case "in_doubt":
      return { text: "!", tone: "wait" };
    case "done":
      return { text: "✔", tone: "ok" };
    case "failed":
      return { text: "✘", tone: "bad" };
    default:
      return { text: "○", tone: "off" };
  }
}

function runTone(status: string): McpTone {
  return status === "done" ? "ok" : status === "failed" ? "bad" : status === "waiting" ? "wait" : status === "running" ? "ok" : "off";
}

function startedText(startedAt: string | null | undefined): string {
  if (startedAt === null || startedAt === undefined) return "";
  const at = new Date(startedAt);
  return Number.isNaN(at.getTime()) ? "" : `started ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** Who started it, when, how long, "usually about 45s" while it goes, and the models its steps used. */
function factsLine(status: WorkflowStatusResult, now: number): string {
  const { run } = status;
  const models = [...new Set((status.steps ?? []).map((step) => step.model).filter((model): model is string => model !== null && model !== undefined && model !== ""))];
  return [run.trigger === "" ? "" : `by ${run.trigger}`, startedText(run.started_at), workflowRunTook(run, now), run.status === "running" ? usualWords(run.usual_ms) : "", models.join(", ")].filter((part) => part !== "").join(" · ");
}

const BAR_WIDTH = 24;

/** `━━━━━━────  5 of 7 steps`: one line. With no total known there is no bar, only "5 steps so far". */
function progressLine(progress: ReturnType<typeof stepsProgress>): string {
  if (!progress.known || progress.total === 0) return progress.words;
  const filled = Math.round((Math.min(progress.done, progress.total) / progress.total) * BAR_WIDTH);
  return `${"━".repeat(filled)}${"─".repeat(BAR_WIDTH - filled)}  ${progress.words}`;
}

function repeatMark(state: string): string {
  return state === "waiting" || state === "running" || state === "failed" || state === "done" ? state : "pending";
}

/** `12 of 30`, with `· 1 failed` when an item failed. */
function repeatRight(row: Extract<RunStepRow, { kind: "repeat" }>): string {
  const failed = row.items.filter((item) => item.status === "failed" || item.status === "in_doubt").length;
  return `${repeatCount(row)}${failed === 0 ? "" : ` · ${failed} failed`}`;
}

/** What the run came out with, one line each by kind, or for a done run with no result what it did, or that nothing was found. */
function resultLines(status: WorkflowStatusResult): McpManagerLine[] {
  const outputs = runOutputs(status.run);
  const many = outputs.length > 1;
  if (outputs.length > 0) {
    return outputs.slice(0, 3).map((output): McpManagerLine => {
      const kind = resultKind(output.value);
      const line = kind === "file" ? `file ${String(output.value).trim()}` : (output.summary ?? stepOutputLine({ kind: "step", result: output.value }));
      return { text: `${many ? `${output.title}: ` : "Result: "}${line}`, mark: { text: "✔", tone: "ok" } };
    });
  }
  if (status.run.status !== "done") return [];
  const did = whatItDid(status.steps ?? []);
  if (did.length === 0) return [{ text: `Result: ${EMPTY_RESULT_WORDS}`, dim: true }];
  return did.slice(0, 3).map((step): McpManagerLine => ({ text: `${stepLabel(step)}: ${stepOutputLine(step)}`, mark: { text: "✔", tone: "ok" } }));
}

/** A file output as `workflow.read_output` read it, or why it could not. */
export type OutputFile = { path: string; text: string; truncated: boolean } | { error: string };

function plainLines(source: string, width: number): string[] {
  return markdownLines(source, width).map((spans) => spans.map((span) => span.text).join("").trimEnd());
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** A table (a list of records) as aligned columns: a header, a rule, then the rows. */
function tableLines(rows: readonly Record<string, unknown>[]): string[] {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const text = rows.map((row) => columns.map((column) => cellText(row[column]).replace(/\s+/g, " ")));
  const widths = columns.map((column, at) => Math.min(40, Math.max(column.length, ...text.map((row) => row[at]?.length ?? 0))));
  const cut = (value: string, at: number): string => ((widths[at] ?? 0) < value.length ? `${value.slice(0, (widths[at] ?? 1) - 1)}…` : value).padEnd(widths[at] ?? 0);
  const draw = (cells: readonly string[]): string => cells.map(cut).join("  ").trimEnd();
  return [draw(columns), widths.map((width) => "─".repeat(width)).join("  "), ...text.map(draw), "", `${rows.length} ${rows.length === 1 ? "row" : "rows"}`];
}

/**
 * The text `r` puts in the pager: each result by its kind. Text is rendered as Markdown, a table as a table, a file
 * as it was read (rendered when it is a `.md` file), a link or record as it is. `files` holds the files the app read.
 */
export function resultPagerText(outputs: readonly RunOutput[], files: ReadonlyMap<number, OutputFile>, width: number): string {
  const blocks = outputs.map((output) => {
    const kind = resultKind(output.value);
    const head = outputs.length > 1 || output.title !== "Result" ? [output.title, "─".repeat(Math.min(width, output.title.length)), ""] : [];
    const summary = output.summary === null ? [] : [output.summary, ""];
    let body: string[];
    const file = output.index === null ? undefined : files.get(output.index);
    if (kind === "file" && file !== undefined) {
      body =
        "error" in file
          ? [String(output.value).trim(), file.error]
          : [`File ${file.path}`, "", ...(file.path.toLowerCase().endsWith(".md") ? plainLines(file.text, width) : file.text.split("\n")), ...(file.truncated ? ["", "This is the start of the file: it is cut here."] : [])];
    } else if (kind === "text") body = plainLines(String(output.value), width);
    else if (kind === "table") body = tableLines(output.value as Record<string, unknown>[]);
    else body = stepOutputText(output.value).split("\n");
    return [...head, ...summary, ...body].join("\n");
  });
  return blocks.join("\n\n");
}

const HINT_BASE = "↑/↓ choose a step";

function hintLine(status: WorkflowStatusResult, row: RunStepRow | undefined): string {
  const parts = [HINT_BASE];
  if (row?.kind === "repeat") parts.push("Enter opens or folds it");
  else if (row?.step.child_session_id !== null && row?.step.child_session_id !== undefined) parts.push("Enter opens its chat");
  if ((status.reviews ?? []).length > 0) parts.push(REVIEW_KEYS);
  else if (resultOutputs(status).length > 0) parts.push("r result");
  if (runIsLive(status.run)) parts.push("c cancel the run");
  if (status.run.status === "failed") parts.push("s resume");
  parts.push("Esc back");
  return parts.join(" · ");
}

/** The line a step shows to the right of its title: its time, then its result, its error, or where it stands. */
function stepRight(step: WorkflowStepInfo): string {
  if (step.status === "failed" && step.error !== null && step.error !== undefined) return step.error.split("\n").find((line) => line.trim() !== "")?.trim() ?? stepWords(step.status);
  const output = stepOutputLine(step);
  if (step.status === "done" && output !== "") return output;
  if (step.status === "pending") return "not started";
  return step.status === "running" || step.status === "waiting" || step.status === "in_doubt" ? stepWords(step.status) : output || stepWords(step.status);
}

const OUTPUT_ROWS = 8;

/** What the selected step unfolds: its kind, model and cost, its helper session, a worker's copy, its output, its error. */
export function stepDetail(step: WorkflowStepInfo, width: number): McpManagerLine[] {
  const lines: McpManagerLine[] = [];
  const line = (text: string, extra: Partial<McpManagerLine> = {}) => lines.push({ prefix: "    ", text, ...extra });
  line(stepMetaLine(step), { dim: true });
  if (step.error !== null && step.error !== undefined && step.error !== "") {
    for (const row of step.error.split("\n").filter((text) => text.trim() !== "").slice(0, 3)) line(row, { mark: { text: "✘", tone: "bad" } });
  }
  if (step.child_session_id !== null && step.child_session_id !== undefined) line(`helper session ${step.child_session_id} · Enter opens its chat`);
  const worker = workerResult(step.result);
  if (worker !== null) {
    line(`copy      ${worker.worktree}`);
    line(`changed   ${workerLine(worker).replace(/ · checks.*$| · no checks$/, "")}`);
    line(`checks    ${worker.checks}${worker.checksNote === null ? "" : `: ${worker.checksNote}`}`);
  } else {
    const text = stepOutputText(step.result);
    if (text !== "") {
      const rows = text.split("\n");
      for (const row of rows.slice(0, OUTPUT_ROWS)) line(row.length > width - 4 ? `${row.slice(0, Math.max(0, width - 5))}…` : row);
      if (rows.length > OUTPUT_ROWS) line(`… ${rows.length - OUTPUT_ROWS} more lines`, { dim: true });
    }
  }
  return lines;
}

function reviewBlock(reviews: readonly WorkflowReviewInfo[]): McpManagerLine[] {
  const review = reviews[0];
  if (review === undefined) return [];
  const draft = reviewDraftText(review.draft).split("\n").filter((row) => row.trim() !== "");
  const more = reviews.length > 1 ? ` · ${reviews.length} waiting` : "";
  return [
    { text: `Review · ${reviewTitle(review)}${more}`, bold: true, mark: { text: "!", tone: "wait" } },
    ...draft.slice(0, 3).map((row): McpManagerLine => ({ prefix: "  ", text: row })),
    ...(draft.length > 3 ? [{ prefix: "  ", text: `… ${draft.length - 3} more lines`, dim: true } as McpManagerLine] : []),
  ];
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function layoutWorkflowRun(input: { state: WorkflowRunManagerState; data: WorkflowRunData; now: number; columns: number; rows: number }): McpManagerLine[] {
  const width = Math.max(1, input.columns);
  const { data, state } = input;
  const status = data.status;
  let head: McpManagerLine[];
  const body: McpManagerLine[] = [];
  let foot: McpManagerLine[] = [];
  let hint = "Esc back";
  if (status === null) {
    head = [{ text: "Workflow run", bold: true }, { text: "" }, data.error === null ? { text: "asking the daemon…", dim: true } : { text: data.error }];
  } else {
    const { run } = status;
    const steps = status.steps ?? [];
    const rows = foldSteps(steps);
    const live = runIsLive(run);
    const title = run.title !== null && run.title !== undefined && run.title !== "" ? run.title : run.name;
    head = [
      {
        text: `${title}  ${workflowRunWords(run.status)}`,
        bold: true,
        mark: { text: run.status === "done" ? "✔" : run.status === "failed" ? "✘" : run.status === "waiting" ? "!" : run.status === "running" ? "●" : "○", tone: runTone(run.status) },
      },
      { text: factsLine(status, input.now), dim: true },
    ];
    if (run.description !== undefined && run.description !== "") head.push({ text: `Goal: ${run.description}` });
    if (run.summary !== null && run.summary !== undefined && run.summary !== "") head.push({ text: run.summary, bold: true });
    if (run.status === "failed" && run.error !== null && run.error !== undefined) head.push({ text: run.error.split("\n").find((row) => row.trim() !== "") ?? run.error, mark: { text: "✘", tone: "bad" } });
    if (rows.length > 0) head.push({ text: progressLine(stepsProgress(rows, { live, expected: run.steps_expected ?? null })) });
    head.push(...resultLines(status));
    for (const working of liveLines(rows, input.now)) head.push({ text: `${working.text}${working.took === "" ? "" : `  ${working.took}`}`, mark: { text: "●", tone: "ok" } });
    for (const text of live ? liveTexts(steps) : []) {
      head.push({ text: `${text.label}:`, dim: true });
      for (const row of text.text.split("\n").filter((part) => part.trim() !== "").slice(-2)) head.push({ prefix: "  ", text: row.trim() });
    }
    head.push({ text: "" });
    const chosen = clamp(state.selected, rows.length);
    const labelOf = (row: RunStepRow): string => (row.kind === "step" ? stepLabel(row.step) : row.title);
    const tookOf = (row: RunStepRow): string => (row.kind === "step" ? workflowRunTook(row.step, input.now) : "");
    const titleWidth = Math.max(0, ...rows.map((row) => labelOf(row).length));
    const tookWidth = Math.max(0, ...rows.map((row) => tookOf(row).length));
    if (rows.length === 0) body.push({ text: "No step has started yet.", dim: true });
    let before: string | null = null;
    for (const [index, row] of rows.entries()) {
      const group = groupWords(row.kind === "step" ? row.step : (row.items[0] ?? { group: null }));
      if (group !== null && group !== before) body.push({ text: `┌ ${group}`, dim: true });
      before = group;
      body.push({
        prefix: index === chosen ? "❯ " : "  ",
        mark: stepMark(row.kind === "step" ? row.step.status : repeatMark(row.state)),
        text: `${labelOf(row).padEnd(titleWidth)}${tookOf(row).padEnd(tookWidth)}  ${row.kind === "step" ? stepRight(row.step) : repeatRight(row)}`.trimEnd(),
        selected: index === chosen,
      });
      if (row.kind === "step") {
        if (index === chosen) body.push(...stepDetail(row.step, width));
      } else if (state.unfolded.includes(row.title)) {
        for (const item of row.items) body.push({ prefix: "    ", mark: stepMark(item.status), text: `${item.item ?? ""}  ${stepRight(item)}`.trimEnd() });
      }
    }
    foot = reviewBlock(status.reviews ?? []);
    if (foot.length > 0) foot.unshift({ text: "" });
    hint = hintLine(status, rows[chosen]);
  }
  const tail: McpManagerLine[] = [...foot, ...(state.notice === null ? [] : [{ text: state.notice, mark: { text: "!", tone: "wait" } as const }]), { text: "" }, { text: hint, dim: true }];
  const room = Math.max(0, input.rows - head.length - tail.length);
  const selectedAt = Math.max(0, body.findIndex((line) => line.selected === true));
  const start = body.length <= room ? 0 : Math.min(Math.max(0, selectedAt - Math.floor(room / 2)), body.length - room);
  const lines = [...head, ...body.slice(start, start + room), ...tail];
  return lines.slice(0, Math.max(0, input.rows)).map((line) => {
    const used = (line.prefix?.length ?? 0) + (line.mark ? line.mark.text.length + 1 : 0);
    return { ...line, text: fit(line.text, Math.max(1, width - used)) };
  });
}
