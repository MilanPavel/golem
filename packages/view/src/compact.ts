/** The one line a client prints after `/compact` or `/context clear`. Shared by the web and the terminal. */

import type { SessionCompactResult } from "@golem/client";

import { formatTurnTime } from "./duration.ts";

export type CompactAction = "clear" | "summarise";

export const NOTHING_TO_COMPACT = "nothing to compact yet";

/** The line shown while a summary is being written, which can take a minute with a local model. */
export const COMPACTING = "summarising earlier turns …";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** `ctx 84% → 31%` when the window is known, else the token counts. */
export function contextShift(result: SessionCompactResult): string {
  const window = result.window ?? null;
  if (window === null || window <= 0) {
    return `ctx ${result.before_tokens} → ${result.after_tokens} tokens`;
  }
  const share = (tokens: number): string => `${Math.round((tokens / window) * 100)}%`;
  return `ctx ${share(result.before_tokens)} → ${share(result.after_tokens)}`;
}

function took(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : formatTurnTime(ms);
}

/**
 * What a compaction did, in one line: `summarised 9 earlier turns with qwen3:27b · ctx 84% → 31% · 6.2 s`,
 * `cleared 12 old tool results · ctx 71% → 38%`, or `nothing to compact yet` when the count is 0.
 * `ms` is how long the call took, shown for a summary.
 */
export function compactLine(action: CompactAction, result: SessionCompactResult, ms: number): string {
  if (result.count === 0) {
    return NOTHING_TO_COMPACT;
  }
  const shift = contextShift(result);
  if (action === "clear") {
    return `cleared ${plural(result.count, "old tool result", "old tool results")} · ${shift}`;
  }
  const model = result.model ? ` with ${result.model}` : "";
  const time = Number.isFinite(ms) && ms >= 0 ? ` · ${took(ms)}` : "";
  return `summarised ${plural(result.count, "earlier turn", "earlier turns")}${model} · ${shift}${time}`;
}
