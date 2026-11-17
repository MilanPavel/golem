import type { ToolBlock } from "./chat-state.ts";
import { formatTokens } from "./context.ts";
import { formatCost } from "./cost.ts";
import { formatElapsed } from "./duration.ts";

/** The tool that starts a helper. */
export const DELEGATE_TOOL = "delegate";

/** The helper `delegate` starts when its call names none. */
export const DEFAULT_HELPER = "explorer";

/** A tool call is a helper's when it is a `delegate` call. */
export function isDelegate(tool: Pick<ToolBlock, "name">): boolean {
  return tool.name === DELEGATE_TOOL;
}

/** The name of the helper a `delegate` call asked for. */
export function helperName(step: Pick<ToolBlock, "args">): string {
  const agent = step.args.agent;
  return typeof agent === "string" && agent !== "" ? agent : DEFAULT_HELPER;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The tool steps of a helper, newest last. Empty before it made a call. */
function stepsOf(step: ToolBlock): readonly ToolBlock[] {
  return step.child?.toolSteps ?? [];
}

/** What the helper does now, such as `reading src/router.py`. Null while it has no call open. */
function doing(steps: readonly ToolBlock[]): string | null {
  const open = [...steps].reverse().find((tool) => tool.status === "requested" || tool.status === "running");
  if (open === undefined) return null;
  const args = open.args;
  const target = [args.path, args.pattern, args.query, args.ref].find((value) => typeof value === "string" && value !== "");
  const shown = typeof target === "string" ? target : "";
  switch (open.name) {
    case "read_file":
      return `reading ${shown}`.trim();
    case "list_dir":
      return `listing ${shown}`.trim();
    case "glob":
    case "grep":
      return `searching ${shown}`.trim();
    default:
      return open.name;
  }
}

/** `read 14 files, 3 searches`: the helper's calls counted by kind, in the order each first appears. */
export function helperCounts(steps: readonly ToolBlock[]): string {
  const counts = new Map<string, { count: number; label: (count: number) => string }>();
  for (const { name } of steps) {
    let key = name;
    let label = (count: number): string => plural(count, `${name} call`, `${name} calls`);
    if (name === "read_file") {
      label = (count) => `read ${plural(count, "file", "files")}`;
    } else if (name === "grep" || name === "glob") {
      key = "search";
      label = (count) => plural(count, "search", "searches");
    } else if (name === "list_dir") {
      label = (count) => `listed ${plural(count, "folder", "folders")}`;
    } else if (name.startsWith("git_")) {
      key = "git";
      label = (count) => plural(count, "git command", "git commands");
    }
    const entry = counts.get(key) ?? { count: 0, label };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].map((entry) => entry.label(entry.count)).join(", ");
}

function took(step: ToolBlock): string | null {
  const ms = step.child?.durationMs ?? null;
  return ms === null ? null : formatElapsed(ms);
}

/** `returned 620 tokens`, or null when the helper's last call did not say. */
function returned(step: ToolBlock): string | null {
  const tokens = step.child?.answerTokens ?? null;
  return tokens === null ? null : `returned ${formatTokens(tokens)} tokens`;
}

/**
 * The one line of a `delegate` call, in the web chat and the terminal.
 *
 * Done: `explorer · qwen3:27b · read 14 files · 1m 12s · returned 620 tokens`.
 * Running: `explorer · qwen3:27b · reading src/router.py…`.
 */
export function helperLine(step: ToolBlock): string {
  const model = step.child?.model ?? null;
  const head = [helperName(step), ...(model === null ? [] : [model])];
  if (step.status === "failed") {
    return [...head, "failed"].join(" · ");
  }
  if (step.status !== "done") {
    return [...head, `${doing(stepsOf(step)) ?? "starting"}…`].join(" · ");
  }
  const counts = helperCounts(stepsOf(step));
  const parts = [...head, ...(counts === "" ? [] : [counts]), took(step), returned(step)];
  return parts.filter((part): part is string => part !== null).join(" · ");
}

/** The first line of the terminal tree: `delegate · explorer · qwen3:27b · 1m 12s · $0.00`. */
export function helperHead(step: ToolBlock): string {
  const model = step.child?.model ?? null;
  const cost = formatCost(step.child?.costUsd ?? null);
  const parts = [DELEGATE_TOOL, helperName(step), model, step.status === "done" ? took(step) : null, cost];
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

/** `read_file ×14 · grep ×3`: the helper's calls by tool name. */
export function helperToolCounts(steps: readonly ToolBlock[]): string {
  const counts = new Map<string, number>();
  for (const { name } of steps) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => `${name} ×${count}`).join(" · ");
}

/** The rows under the head of the terminal tree: the calls by name, then what came back. */
export function helperTreeRows(step: ToolBlock): string[] {
  const rows: string[] = [];
  const counts = helperToolCounts(stepsOf(step));
  if (counts !== "") rows.push(counts);
  if (step.status === "done") {
    const back = returned(step);
    if (back !== null) rows.push(`↳ ${back}`);
  } else if (step.status === "failed") {
    rows.push("↳ failed");
  } else {
    rows.push(`↳ ${doing(stepsOf(step)) ?? "starting"}…`);
  }
  return rows;
}

/** Why a helper ended, as the `delegate` result names it: `explorer finished: <reason>`. */
export type HelperStop = "done" | "calls" | "time" | "budget" | "tokens" | "cancelled";

const STOP_WORDS: Record<Exclude<HelperStop, "done">, string> = {
  calls: "call limit",
  time: "time limit",
  budget: "budget spent",
  tokens: "token limit",
  cancelled: "cancelled",
};

/** The reason a `delegate` result starts with, or `done` when it has none. */
export function helperStop(result: string): string {
  const match = /^explorer finished: (\S+)\n/.exec(result);
  return match?.[1] ?? "done";
}

/** `stopped: time limit` for a helper that hit a limit. Empty when it is `done`. */
export function helperStopWords(stopped: string): string {
  if (stopped === "done" || stopped === "") return "";
  const words = (STOP_WORDS as Record<string, string | undefined>)[stopped] ?? stopped;
  return `stopped: ${words}`;
}
