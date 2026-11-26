import { formatCost } from "./cost.ts";
import { runStartedText } from "./runs.ts";
import { workflowRunWords } from "./workflow-list.ts";

/**
 * A workflow's outline in words (3.11.3): the numbered steps `workflow.get` reads from the file, with what each is
 * (kind, agent) and what repeats or guards it (`for each`, `if`). Pure, typed by shape, so the page and the terminal
 * say the same.
 */

/** The parts of a `WorkflowOutlineStep` these words read. */
export type OutlineStepLike = {
  id: string;
  kind: string;
  title: string;
  agent?: string | null;
  for_each?: string | null;
  condition?: string | null;
  gets?: string | null;
  budget?: string | null;
  key?: string | null;
  /** The first and last line in the file. The generated type leaves the pair open. */
  lines?: readonly unknown[];
};

export type OutlineRow = {
  /** From 1, in file order. */
  number: number;
  id: string;
  title: string;
  /** What it is, then what repeats or guards it. */
  notes: string[];
  /** The step's first line in the file, or null. */
  line: number | null;
  key: string | null;
};

/** The step's first line in the file (from 1), or null when the daemon sent none. */
export function outlineLine(step: Pick<OutlineStepLike, "lines">): number | null {
  const first: unknown = step.lines?.[0];
  return typeof first === "number" && Number.isInteger(first) && first >= 1 ? first : null;
}

/** How one step reads: its kind, then agent, `for each`, `if`, `gets` and `budget`. */
export function outlineNotes(step: OutlineStepLike): string[] {
  const notes: string[] = [step.kind];
  if (step.agent) notes.push(`agent ${step.agent}`);
  if (step.for_each) notes.push(`for each ${step.for_each}`);
  if (step.condition) notes.push(`if ${step.condition}`);
  if (step.gets) notes.push(`gets ${step.gets}`);
  if (step.budget) notes.push(`budget ${step.budget}`);
  return notes;
}

/** The numbered rows of an outline, in file order. */
export function outlineRows(steps: readonly OutlineStepLike[]): OutlineRow[] {
  return steps.map((step, at) => ({
    number: at + 1,
    id: step.id,
    title: step.title,
    notes: outlineNotes(step),
    line: outlineLine(step),
    key: step.key ?? null,
  }));
}

/** The parts of a `WorkflowStepInfo` and `WorkflowRunInfo` the last-run words read. */
export type RanStepLike = { key: string; started_at?: string | null; cost_usd?: number | null };
export type RanRunLike = { started_at?: string | null; status: string };

/** When the newest run ran each step: the step's key to its start, such as `08:30`. Steps with no start are left out. */
export function stepRanTimes(steps: readonly RanStepLike[], now: number): Map<string, string> {
  const ran = new Map<string, string>();
  for (const step of steps) {
    const when = runStartedText({ session_id: "", status: "succeeded", started_at: step.started_at }, now);
    if (when !== "") ran.set(step.key, when);
  }
  return ran;
}

/** The header of the outline: when the newest run started and what it cost, such as `last run 08:30 · done · $0.04`. Empty with no run. */
export function lastRunLine(run: RanRunLike | null, steps: readonly RanStepLike[], now: number): string {
  if (run === null) return "";
  const when = runStartedText({ session_id: "", status: "succeeded", started_at: run.started_at }, now);
  const parts = [when === "" ? "last run" : `last run ${when}`, workflowRunWords(run.status)];
  const costs = steps.map((step) => step.cost_usd).filter((cost): cost is number => typeof cost === "number");
  if (costs.length > 0) parts.push(formatCost(costs.reduce((sum, cost) => sum + cost, 0)));
  return parts.join(" · ");
}
