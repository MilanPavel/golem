/**
 * The Changes view of workers (ADR-059): one block per worker, a helper that works in its own copy of the
 * project. Pure, so the web and the terminal draw the same blocks and add no word. No model is involved.
 *
 * A block is folded from the lead's log: `helper.started` names the helper, `helper.ended` carries the
 * diff and the checks, `helper.applied` and `helper.discarded` close it.
 */

import type { ChatEvent } from "@golem/client";

import { helperStopWords } from "./helper.ts";

/** One file of a worker's diff. */
export type WorkerBlockFile = { path: string; status: "created" | "modified" | "deleted"; added: number; removed: number };

/**
 * - `running`: a worker that has not ended.
 * - `green`: ended normally (`stopped` is `done`) and its checks did not fail: they passed, or there were none to run.
 * - `failed`: ended normally, but a check failed in the copy.
 * - `stopped`: ended on a limit, a failed model call or a cancel, whatever its checks said.
 * - `applied` / `discarded`: the lead's events; they win over the rest.
 */
export type WorkerStatus = "running" | "green" | "failed" | "stopped" | "applied" | "discarded";

/** What a block offers. `retry` is "Try again, stronger". */
export type WorkerAction = "view" | "apply" | "retry" | "discard";

export type WorkerBlock = {
  helperId: string;
  label: string;
  status: WorkerStatus;
  files: WorkerBlockFile[];
  added: number;
  removed: number;
  /** The diff as an artifact, for View. Null while it runs or when the daemon has none. */
  diffArtifactId: string | null;
  /** `tests pass`, `2 tests fail`-style words, the checks note, and the stop reason, joined with ` · `. Empty when there is nothing to say. */
  checksLine: string;
  actions: WorkerAction[];
};

export type WorkerOptions = {
  /**
   * Whether an agent type works in its own copy. The log does not say so before a helper ends, so a
   * running helper is a worker only when this says yes. Without it only ended workers appear.
   */
  writes?: (agent: string) => boolean;
};

type Ended = Extract<ChatEvent, { type: "helper.ended" }>["data"];

type Draft = {
  helperId: string;
  label: string;
  agent: string;
  ended: Ended | null;
  fate: "applied" | "discarded" | null;
};

/** `tests fail`, `lint fails`, `tests and lint fail`. Null for no names. */
function failWords(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) {
    const name = names[0] ?? "";
    return name.endsWith("s") ? `${name} fail` : `${name} fails`;
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""} fail`;
}

function stopWords(stopped: string, modelCalls: number): string {
  return stopped === "calls" ? `stopped: ${String(modelCalls)} calls` : helperStopWords(stopped);
}

function checksParts(data: Ended): string[] {
  const parts: string[] = [];
  const stop = stopWords(data.stopped, data.model_calls);
  if (stop !== "") parts.push(stop);
  if (data.checks === "passed") parts.push("tests pass");
  else if (data.checks === "failed") parts.push(failWords(data.checks_failed ?? []) ?? "checks fail");
  else if (data.checks_note) parts.push(data.checks_note);
  return parts;
}

function statusOf(draft: Draft): WorkerStatus {
  if (draft.fate !== null) return draft.fate;
  const data = draft.ended;
  if (data === null) return "running";
  if (data.stopped !== "done") return "stopped";
  return data.checks === "failed" ? "failed" : "green";
}

const ACTIONS: Record<WorkerStatus, WorkerAction[]> = {
  running: [],
  green: ["view", "apply"],
  failed: ["view", "retry", "discard"],
  stopped: ["view", "retry", "discard"],
  applied: [],
  discarded: [],
};

function blockOf(draft: Draft): WorkerBlock {
  const status = statusOf(draft);
  const data = draft.ended;
  const files = (data?.files ?? []).map((file) => ({ path: file.path, status: file.status, added: file.added, removed: file.removed }));
  return {
    helperId: draft.helperId,
    label: draft.label,
    status,
    files,
    added: data?.added ?? files.reduce((sum, file) => sum + file.added, 0),
    removed: data?.removed ?? files.reduce((sum, file) => sum + file.removed, 0),
    diffArtifactId: data?.diff_artifact_id ?? null,
    checksLine: data === null ? "" : checksParts(data).join(" · "),
    actions: [...ACTIONS[status]],
  };
}

/** One block per worker of the lead's log, in the order the helpers started. */
export function workerBlocks(events: readonly ChatEvent[], options: WorkerOptions = {}): WorkerBlock[] {
  const drafts = new Map<string, Draft>();
  const byCall = new Map<string, Draft>();
  for (const event of events) {
    switch (event.type) {
      case "helper.started": {
        const data = event.data;
        const draft: Draft = { helperId: data.helper_id, label: data.label, agent: data.agent, ended: null, fate: null };
        drafts.set(data.helper_id, draft);
        byCall.set(`${data.call_id}/${String(data.index)}`, draft);
        break;
      }
      case "helper.ended": {
        const draft = byCall.get(`${event.data.call_id}/${String(event.data.index)}`);
        if (draft) draft.ended = event.data;
        break;
      }
      case "helper.applied": {
        const draft = drafts.get(event.data.helper_id);
        if (draft) draft.fate = "applied";
        break;
      }
      case "helper.discarded": {
        const draft = drafts.get(event.data.helper_id);
        if (draft) draft.fate = "discarded";
        break;
      }
      default:
    }
  }
  const writes = options.writes ?? (() => false);
  return [...drafts.values()]
    .filter((draft) => (draft.ended === null ? writes(draft.agent) : draft.ended.files != null || draft.ended.diff_artifact_id != null))
    .map(blockOf);
}

/** How many blocks can be applied together: the green ones. */
export function greenCount(blocks: readonly WorkerBlock[]): number {
  return blocks.filter((block) => block.status === "green").length;
}

/** `Apply the green one`, `Apply the 2 green`. Null for none. */
export function applyGreenLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "Apply the green one" : `Apply the ${String(count)} green`;
}

/**
 * The footer: `in copies · nothing in ~/repos/app has changed` while nothing is applied, else
 * `1 applied · 3 in copies`. Null for no blocks. A block is in a copy until it is applied or discarded.
 */
export function copiesFooter(blocks: readonly WorkerBlock[], folder: string): string | null {
  if (blocks.length === 0) return null;
  const applied = blocks.filter((block) => block.status === "applied").length;
  const copies = blocks.filter((block) => block.status !== "applied" && block.status !== "discarded").length;
  if (applied === 0) return copies > 0 ? `in copies · nothing in ${folder} has changed` : `nothing in ${folder} has changed`;
  return copies > 0 ? `${String(applied)} applied · ${String(copies)} in copies` : `${String(applied)} applied`;
}

/** The numbers of a block: `+38 −12`. */
export function workerDiffStat(block: Pick<WorkerBlock, "added" | "removed">): string {
  return `+${String(block.added)} −${String(block.removed)}`;
}
