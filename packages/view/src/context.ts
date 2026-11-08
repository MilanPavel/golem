import type { TraceContext, TraceContextPart } from "@golem/client";

export type { TraceContext, TraceContextPart };
export type ContextKey = TraceContextPart["key"];
export type ContextLevel = "ok" | "high" | "full";

/** Characters per token for the estimate: the same number the MCP supervisor uses. */
export const CHARS_PER_TOKEN = 4;

/** The display order of the parts. */
export const CONTEXT_KEYS: readonly ContextKey[] = ["system", "tools", "user", "assistant", "tool_results"];

export const CONTEXT_LABELS: Record<ContextKey | "free", string> = {
  system: "System prompt",
  tools: "Tool definitions",
  user: "Your messages",
  assistant: "Replies",
  tool_results: "Tool results",
  free: "Free",
};

/** `612`, then `9.1K` from a thousand on. */
export function formatTokens(count: number): string {
  return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}K`;
}

/** A window size, which is a round number: `128K`, `32K`, `1M`. */
export function formatWindow(count: number): string {
  if (count >= 1_000_000 && count % 1_000_000 === 0) return `${count / 1_000_000}M`;
  if (count >= 1_048_576 && count % 1_048_576 === 0) return `${count / 1_048_576}M`;
  if (count >= 1000 && count % 1000 === 0) return `${count / 1000}K`;
  if (count >= 1024 && count % 1024 === 0) return `${count / 1024}K`;
  return formatTokens(count);
}

/** The provider's input tokens, or the sum of the parts when it reported none. */
export function contextUsed(ctx: TraceContext): number {
  return ctx.used ?? ctx.parts.reduce((sum, part) => sum + part.tokens, 0);
}

/** How much of the window is used, 0 to 1. Null when either side is unknown. */
export function contextShare(used: number | null, window: number | null): number | null {
  if (used === null || window === null || !(window > 0)) return null;
  return Math.min(1, used / window);
}

export function contextPercent(share: number): number {
  return Math.floor(share * 100);
}

export function contextLevel(used: number | null, window: number | null): ContextLevel {
  const share = contextShare(used, window);
  if (share === null) return "ok";
  if (share >= 0.95) return "full";
  if (share >= 0.8) return "high";
  return "ok";
}

/** `32.0K / 128K · 25%`, with `≈` before an estimated window, and just `32.0K` with no window. */
export function contextSummary(used: number, window: number | null, estimatedWindow: boolean): string {
  const share = contextShare(used, window);
  if (window === null || share === null) return formatTokens(used);
  return `${formatTokens(used)} / ${estimatedWindow ? "≈" : ""}${formatWindow(window)} · ${contextPercent(share)}%`;
}

/**
 * True when the input is more than the `num_ctx` sent to Ollama. Ollama reports the input after it
 * cut it, so the raw characters of the parts are checked as well.
 */
export function overNumCtx(ctx: TraceContext): boolean {
  const numCtx = ctx.num_ctx ?? null;
  if (numCtx === null) return false;
  if (contextUsed(ctx) >= numCtx) return true;
  const chars = ctx.parts.reduce((sum, part) => sum + part.chars, 0);
  return Math.round(chars / CHARS_PER_TOKEN) > numCtx;
}

export function contextWarning(ctx: TraceContext): string | null {
  const numCtx = ctx.num_ctx ?? null;
  const window = ctx.window ?? null;
  if (numCtx !== null && overNumCtx(ctx)) {
    return `Input is larger than num_ctx ${formatWindow(numCtx)}. Ollama dropped the oldest part.`;
  }
  const used = contextUsed(ctx);
  const share = contextShare(used, window);
  const level = contextLevel(used, window);
  if (share !== null && (level === "full" || level === "high")) return `Context is ${contextPercent(share)}% full.`;
  return null;
}

/** What to say when the window is not known. */
export function windowUnknownHint(provider: string | null): string {
  return provider === "ollama"
    ? "golem sent no num_ctx, so Ollama used its own default window. Set ctx on the profile to see how full it is."
    : "golem does not know this model's window.";
}

/** Cells of a bar `width` wide for each part, in display order, and the free rest. */
export function contextCells(
  parts: readonly TraceContextPart[],
  window: number | null,
  width: number,
): { key: ContextKey | "free"; cells: number }[] {
  const tokensOf = (key: ContextKey): number => parts.find((part) => part.key === key)?.tokens ?? 0;
  const used = CONTEXT_KEYS.reduce((sum, key) => sum + tokensOf(key), 0);
  const total = Math.max(window ?? 0, used);
  if (total === 0) return [{ key: "free", cells: width }];
  const raw = CONTEXT_KEYS.map((key) => (tokensOf(key) / total) * width);
  const cells = raw.map((value) => Math.floor(value));
  let left = Math.round((used / total) * width) - cells.reduce((sum, count) => sum + count, 0);
  const order = raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (let at = 0; left > 0 && order.length > 0; at = (at + 1) % order.length, left -= 1) {
    const slot = order[at];
    if (slot !== undefined) cells[slot.index] = (cells[slot.index] ?? 0) + 1;
  }
  const taken = cells.reduce((sum, count) => sum + count, 0);
  return [...CONTEXT_KEYS.map((key, index) => ({ key, cells: cells[index] ?? 0 })), { key: "free" as const, cells: Math.max(0, width - taken) }];
}

/** `█` for each used cell, then `░` for each free one. */
export function contextBar(parts: readonly TraceContextPart[], window: number | null, width: number): string {
  return contextCells(parts, window, width)
    .map(({ key, cells }) => (key === "free" ? "░" : "█").repeat(cells))
    .join("");
}
