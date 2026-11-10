import type { ChatEvent, TraceContext, TraceContextPart, TraceModelSpan, TraceRunSpan } from "@golem/client";

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
    ? "golem does not know this model's window yet. It learns it after the first answer, or you can set ctx on the profile."
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

/** The context of the latest model call that reported its input tokens. */
export type LiveContext = { spanId: string; used: number; window: number | null; windowEstimated: boolean; numCtx: number | null };

/** `pending` is the call that started and has not ended: its window waits for its usage. */
export type LiveContextState = {
  last: LiveContext | null;
  pending: { spanId: string; window: number | null; windowEstimated: boolean; numCtx: number | null } | null;
};

export const emptyLiveContext: LiveContextState = { last: null, pending: null };

/**
 * Fold one event into the live context. A call that ends with no usage keeps the previous `last`.
 * Any event that changes nothing returns `state` itself.
 */
export function foldLiveContext(state: LiveContextState, event: ChatEvent): LiveContextState {
  if (event.type === "model.call.started") {
    return {
      ...state,
      pending: {
        spanId: event.data.message_id,
        window: event.data.context_window ?? null,
        windowEstimated: event.data.window_estimated ?? false,
        numCtx: event.data.num_ctx ?? null,
      },
    };
  }
  if (event.type === "model.call.completed") {
    const pending = state.pending;
    if (pending === null || pending.spanId !== event.data.message_id) return state;
    const input = event.data.usage?.input;
    if (typeof input !== "number") return { ...state, pending: null };
    // The window read after the call is exact and replaces the forecast made before it.
    const read = event.data.context_window ?? null;
    const exact = read !== null;
    let window = exact ? read : pending.window;
    let windowEstimated = exact ? false : pending.windowEstimated;
    // An estimated window below the input is a bad guess: show it as unknown, never over 100%.
    if (window !== null && windowEstimated && input > window) {
      window = null;
      windowEstimated = false;
    }
    return { last: { spanId: pending.spanId, used: input, window, windowEstimated, numCtx: pending.numCtx }, pending: null };
  }
  return state;
}

/** The last model call of the last run that has one, or null. */
export function latestModelSpan(runs: readonly TraceRunSpan[]): TraceModelSpan | null {
  for (let at = runs.length - 1; at >= 0; at -= 1) {
    const calls = runs[at]?.children ?? [];
    const last = calls[calls.length - 1];
    if (last !== undefined) return last;
  }
  return null;
}

/** What the context panel shows: a read in progress, nothing to read, a failure, or the context. */
export type ContextReport =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "ready"; model: string | null; context: TraceContext | null; provider?: string | null };

const BUILT_IN = "built-in";
const SERVERS_SHOWN = 5;

/** A whole percent of `of`, with `<1%` for a share above 0 and below 1%. */
function partPercent(tokens: number, of: number): string {
  if (!(of > 0) || tokens <= 0) return "0%";
  const percent = (tokens / of) * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

function toolServerLines(part: TraceContextPart): string[] {
  const groups = new Map<string, { tokens: number; count: number }>();
  for (const item of part.items ?? []) {
    const name = item.group ?? BUILT_IN;
    const group = groups.get(name) ?? { tokens: 0, count: 0 };
    group.tokens += item.tokens;
    group.count += 1;
    groups.set(name, group);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
  const row = (text: string, tokens: number): string => `${text.padEnd(28)}${formatTokens(tokens).padStart(6)}`;
  const lines = sorted
    .slice(0, SERVERS_SHOWN)
    .map(([name, { tokens, count }]) => row(`  ${name} · ${count} ${count === 1 ? "tool" : "tools"}`, tokens));
  const rest = sorted.slice(SERVERS_SHOWN);
  if (rest.length > 0) {
    const tokens = rest.reduce((sum, [, group]) => sum + group.tokens, 0);
    lines.push(row(`  +${rest.length} more ${rest.length === 1 ? "server" : "servers"}`, tokens));
  }
  return lines;
}

/** One line of the panel: segments in order, a part's own colour on the segments that name one. */
export type ContextLine = { text: string; part?: ContextKey | "free" }[];

/** The panel's grid: rows of cells, the parts in display order, then the free ones. One cell is 0.5% of the window. */
export function contextGrid(
  parts: readonly TraceContextPart[],
  window: number | null,
  rows = 10,
  cols = 20,
): (ContextKey | "free")[][] {
  const flat = contextCells(parts, window, rows * cols).flatMap(({ key, cells }) => Array.from({ length: cells }, () => key));
  return Array.from({ length: rows }, (_, row) => flat.slice(row * cols, (row + 1) * cols));
}

const GRID_WIDTH = 40;
const GRID_GAP = "   ";
/** The least width that holds the grid and the legend side by side. */
const SIDE_BY_SIDE = 84;

function gridLine(cells: readonly (ContextKey | "free")[]): ContextLine {
  const line: ContextLine = [];
  for (const key of cells) {
    const glyph = key === "free" ? "\u25A1 " : "\u25A0 ";
    const last = line[line.length - 1];
    if (last !== undefined && last.part === key) last.text += glyph;
    else line.push({ text: glyph, part: key });
  }
  return line;
}

/** The lines of the context panel, as segments. Lines are not cut to `columns`; the terminal cuts them. */
export function contextReportLines(report: ContextReport, columns: number): ContextLine[] {
  const plain = (text: string): ContextLine => [{ text }];
  switch (report.kind) {
    case "loading":
      return [plain("reading the context…")];
    case "none":
      return [plain("no model call yet — send a message first")];
    case "error":
      return [plain(`could not read the context: ${report.message}`)];
    case "ready":
      break;
  }
  const ctx = report.context;
  if (ctx === null) return [plain("this call has no context record — it ran before golem kept traces")];
  const used = ctx.used ?? null;
  const window = ctx.window ?? null;
  const summary =
    used === null
      ? "usage not reported"
      : window === null
        ? `${formatTokens(used)} · window unknown`
        : contextSummary(used, window, ctx.window_estimated ?? false);
  const base = window ?? used;
  const percentOf = (tokens: number): string => (used === null || base === null ? "" : partPercent(tokens, base));
  const row = (label: string, tokens: number): string =>
    `${label.padEnd(18)}${formatTokens(tokens).padStart(7)}${used === null ? "" : ` ${percentOf(tokens).padStart(5)}`}`;
  const lines: ContextLine[] = [];
  const grid = used !== null && window !== null;
  const servers = ctx.parts.filter((part) => part.key === "tools").flatMap(toolServerLines).map(plain);
  if (used !== null && window !== null) {
    const cells = contextGrid(ctx.parts, window).map(gridLine);
    const head: ContextLine[] = [];
    if (report.model !== null) head.push(plain(report.model));
    head.push(plain(summary), plain(""));
    const legend: ContextLine[] = ctx.parts
      .filter((part) => part.tokens > 0)
      .map((part): ContextLine => [{ text: "\u25A0 ", part: part.key }, { text: row(CONTEXT_LABELS[part.key], part.tokens) }]);
    if (used <= window) legend.push([{ text: "\u25A1 ", part: "free" }, { text: row(CONTEXT_LABELS.free, window - used) }]);
    const side = [...head, ...legend];
    if (columns >= SIDE_BY_SIDE) {
      const height = Math.max(cells.length, side.length);
      for (let at = 0; at < height; at += 1) {
        const left = cells[at] ?? [{ text: " ".repeat(GRID_WIDTH) }];
        const right = side[at];
        lines.push(right === undefined || right.every((segment) => segment.text === "") ? left : [...left, { text: GRID_GAP }, ...right]);
      }
    } else {
      lines.push(...cells, ...side);
    }
  } else {
    lines.push(plain(`context · ${report.model === null ? "" : `${report.model} · `}${summary}`));
    for (const part of ctx.parts) {
      lines.push(plain(row(CONTEXT_LABELS[part.key], part.tokens)));
      if (part.key === "tools") lines.push(...servers);
    }
  }
  if (grid) lines.push(...servers);
  if (ctx.estimated) lines.push(plain("Parts are estimates, scaled to the provider's count."));
  if (window !== null && ctx.window_estimated === true) {
    lines.push(plain("The window is estimated: golem read it from Ollama. It was not sent."));
  }
  if (window === null) lines.push(plain(windowUnknownHint(report.provider ?? null)));
  const warning = contextWarning(ctx);
  if (warning !== null) lines.push(plain(`! ${warning}`));
  return lines;
}

/**
 * The lines of the context panel as plain text, the segments joined. Lines are not cut to `columns`;
 * the terminal cuts them.
 */
export function contextReport(report: ContextReport, columns: number): string[] {
  return contextReportLines(report, columns).map((line) => line.map((segment) => segment.text).join(""));
}
