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
  /** The part that changes in a loop: the source of `item=`. */
  item?: string | null;
  /** The parallel group the step is in, and its title when the code gave one. */
  group?: string | null;
  group_title?: string | null;
  /** What the function a `run.step` calls does: the first sentence of its docstring. */
  does?: string | null;
  /** The first and last line in the file. The generated type leaves the pair open. */
  lines?: readonly unknown[];
};

export type OutlineRow = {
  /** From 1, in file order. */
  number: number;
  id: string;
  title: string;
  /** The part that changes in a loop, shown after the title. */
  item: string | null;
  /** What it is, then what repeats or guards it. */
  notes: string[];
  /** The words of the group the step is in ("At the same time" or the group's title), or null. */
  group: string | null;
  /** The step's first line in the file, or null. */
  line: number | null;
  key: string | null;
};

/** The step's first line in the file (from 1), or null when the daemon sent none. */
export function outlineLine(step: Pick<OutlineStepLike, "lines">): number | null {
  const first: unknown = step.lines?.[0];
  return typeof first === "number" && Number.isInteger(first) && first >= 1 ? first : null;
}

/** The words a group is listed under: its title, else "At the same time". Null for a step that is in no group. */
export function groupWords(step: Pick<OutlineStepLike, "group" | "group_title">): string | null {
  if (step.group === null || step.group === undefined || step.group === "") return null;
  return step.group_title !== null && step.group_title !== undefined && step.group_title !== "" ? step.group_title : "At the same time";
}

/** What repeats a step as words: `for each f in folders` reads `Once for each f in folders`. A bare name is the thing it loops over. */
export function repeatWords(forEach: string): string {
  return forEach
    .split("; ")
    .map((part) => (part.startsWith("while ") ? part : `Once ${part.startsWith("for each ") ? part : `for each ${part}`}`))
    .join("; ");
}

const KIND_WORDS: Readonly<Record<string, string>> = {
  step: "Python",
  llm: "Model",
  agent: "Agent",
  review: "Review",
  notify: "Inbox",
  tool: "Tool",
  skill: "Skill",
  code: "Code",
};

/** What a step's kind is called to a person: `step` is Python, `llm` is Model, `notify` is Inbox. An unknown kind reads as it is. */
export function stepKindWords(kind: string): string {
  return KIND_WORDS[kind] ?? kind;
}

/** How one step reads: its kind, then agent, `for each`, `if`, `gets` and `budget`. */
export function outlineNotes(step: OutlineStepLike): string[] {
  const notes: string[] = [step.kind];
  if (step.agent) notes.push(`agent ${step.agent}`);
  if (step.for_each) notes.push(repeatWords(step.for_each));
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
    item: step.item ?? null,
    notes: outlineNotes(step),
    group: groupWords(step),
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
