import type { WorkflowStatusResult } from "@golem/client";
import {
  reviewDraftText,
  reviewTitle,
  stepMetaLine,
  stepOutputLine,
  stepOutputText,
  stepWords,
  workerResult,
  workerLine,
  workflowRunTook,
  workflowRunWords,
} from "@golem/view";

import type { Press } from "./keys.ts";
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
  /** The screen Esc goes back to. */
  from: "runs" | "workflows" | "other";
};

export const closedWorkflowRun: WorkflowRunManagerState = { open: false, workflowRunId: "", selected: 0, notice: null, from: "other" };

export function openWorkflowRun(workflowRunId: string, from: WorkflowRunManagerState["from"] = "other"): WorkflowRunManagerState {
  return { open: true, workflowRunId, selected: 0, notice: null, from };
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
  const steps = status.steps ?? [];
  const say = (notice: string) => ({ state: { ...state, notice }, action: NONE });
  if (key === "up" || key === "down") return { state: { ...cleared, selected: clamp(state.selected + (key === "up" ? -1 : 1), steps.length) }, action: NONE };
  if (key === "enter") {
    const child = steps[clamp(state.selected, steps.length)]?.child_session_id;
    return child === null || child === undefined ? say("This step has no helper session to open.") : { state: cleared, action: { kind: "open-chat", sessionId: child } };
  }
  const review = status.reviews?.[0];
  if (key === "approve" || key === "reject") {
    if (review === undefined) return say("No review waits on this run.");
    return { state: cleared, action: { kind: "answer", key: review.key, verdict: key === "approve" ? "approve" : "reject" } };
  }
  if (key === "reply") {
    if (review === undefined) return say("No review waits on this run.");
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
  return Number.isNaN(at.getTime()) ? "" : ` · started ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

const HINT_BASE = "↑/↓ choose a step";

function hintLine(status: WorkflowStatusResult, step: WorkflowStepInfo | undefined): string {
  const parts = [HINT_BASE];
  if (step?.child_session_id !== null && step?.child_session_id !== undefined) parts.push("Enter opens its chat");
  if ((status.reviews ?? []).length > 0) parts.push(REVIEW_KEYS);
  if (runIsLive(status.run)) parts.push("c cancel the run");
  if (status.run.status === "failed") parts.push("s resume");
  parts.push("Esc back");
  return parts.join(" · ");
}

function shortId(id: string): string {
  const bare = id.replace(/^wr_/, "");
  return bare.length > 8 ? bare.slice(0, 4) : bare;
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
    const took = workflowRunTook(run, input.now);
    head = [
      {
        text: `${run.name} run ${shortId(run.workflow_run_id)} · ${workflowRunWords(run.status)}${startedText(run.started_at)}${run.trigger === "" ? "" : ` by ${run.trigger}`}${took === "" ? "" : ` · ${took}`}`,
        bold: true,
        mark: { text: run.status === "done" ? "✔" : run.status === "failed" ? "✘" : run.status === "waiting" ? "!" : run.status === "running" ? "●" : "○", tone: runTone(run.status) },
      },
    ];
    if (run.status === "failed" && run.error !== null && run.error !== undefined) head.push({ text: run.error.split("\n").find((row) => row.trim() !== "") ?? run.error, mark: { text: "✘", tone: "bad" } });
    head.push({ text: "" });
    const chosen = clamp(state.selected, steps.length);
    const titleWidth = Math.max(0, ...steps.map((step) => step.title.length));
    const tookWidth = Math.max(0, ...steps.map((step) => workflowRunTook(step, input.now).length));
    if (steps.length === 0) body.push({ text: "No step has started yet.", dim: true });
    for (const [index, step] of steps.entries()) {
      body.push({
        prefix: index === chosen ? "❯ " : "  ",
        mark: stepMark(step.status),
        text: `${step.title.padEnd(titleWidth)}  ${workflowRunTook(step, input.now).padEnd(tookWidth)}  ${stepRight(step)}`.trimEnd(),
        selected: index === chosen,
      });
      if (index === chosen) body.push(...stepDetail(step, width));
    }
    foot = reviewBlock(status.reviews ?? []);
    if (foot.length > 0) foot.unshift({ text: "" });
    hint = hintLine(status, steps[chosen]);
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
