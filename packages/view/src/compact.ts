/** The one line a client prints after `/compact` or `/context clear`. Shared by the web and the terminal. */

import type { SessionCompactResult } from "@golem/client";

import { formatWindow } from "./context.ts";
import { formatTurnTime } from "./duration.ts";

export type CompactAction = "clear" | "summarise" | "grow";

export const NOTHING_TO_COMPACT = "nothing to compact yet";

/** The line shown while a summary is being written, which can take a minute with a local model. */
export const COMPACTING = "summarising earlier turns …";

export function plural(count: number, one: string, many: string): string {
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
  if (action === "grow") {
    const from = result.window_from ?? null;
    const to = result.window_to ?? null;
    return from === null || to === null
      ? "the window will grow on the next turn"
      : `the window will grow ${formatWindow(from)} → ${formatWindow(to)} on the next turn`;
  }
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

function reloadTime(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : formatTurnTime(ms);
}

/** What the chat says once the window grew: `window grew 32K → 64K · reloaded in 8 s`. */
export function windowGrewLine(from: number, to: number, reloadMs: number | null): string {
  const grew = `window grew ${formatWindow(from)} → ${formatWindow(to)}`;
  return reloadMs === null || !Number.isFinite(reloadMs) || reloadMs < 0
    ? grew
    : `${grew} · reloaded in ${reloadTime(reloadMs)}`;
}

/** What the meter says while a call loads the model again with a larger window. */
export function loadingLine(model: string, window: number): string {
  return `loading ${model} with a ${formatWindow(window)} window`;
}
