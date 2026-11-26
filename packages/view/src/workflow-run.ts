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
  status: string;
  error?: string | null;
  child_session_id?: string | null;
  model?: string | null;
  cost_usd?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  result?: unknown;
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
      label: step.title,
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

/** The one line a step's saved result is: text cut to a line, a summary, a worker's diff, or an answer. Empty when there is none. */
export function stepOutputLine(step: Pick<StepLike, "kind" | "result">): string {
  const { result } = step;
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return oneLine(result, 120);
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
  }
  return oneLine(JSON.stringify(result), 120);
}

/** The whole saved result as text: a string as it is, anything else as indented JSON. */
export function stepOutputText(result: unknown): string {
  if (result === null || result === undefined) return "";
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
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
