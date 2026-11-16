import type { ChatEvent, TraceContext, TraceContextPart, TraceModelSpan, TraceRunSpan } from "@golem/client";

import { plural } from "./compact.ts";
import { formatTurnTime } from "./duration.ts";

export type { TraceContext, TraceContextPart };
export type ContextKey = TraceContextPart["key"];
export type ContextLevel = "ok" | "high" | "full";

/** Characters per token for the estimate: the same number the MCP supervisor uses. */
export const CHARS_PER_TOKEN = 4;

/** The display order of the parts. */
export const CONTEXT_KEYS: readonly ContextKey[] = ["system", "tools", "user", "assistant", "tool_results", "summary"];

export const CONTEXT_LABELS: Record<ContextKey | "free" | "reserve" | "cleared", string> = {
  system: "System prompt",
  tools: "Tool definitions",
  user: "Your messages",
  assistant: "Replies",
  tool_results: "Tool results",
  summary: "Summary",
  free: "Free",
  reserve: "Reply reserve",
  cleared: "Cleared",
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

export function contextWarning(ctx: TraceContext): string | null {
  const window = ctx.window ?? null;
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

/** The cut fields of a model span or of its context. */
export type CutFields = Pick<TraceContext, "prompt_cut" | "prompt_cut_kind" | "dropped_message_ids" | "dropped_tokens">;

/**
 * The line to show when Ollama cut a prompt that did not fit, or null when there is nothing to say.
 * `warn` is true for a proven cut and for a prompt cut in the middle. A size of a cut always has `≈`:
 * only the fact of a proven cut is known, never how much was lost. A "no" and an unknown cut say nothing.
 */
export const PLANNED_CUT_NOTE = "The model server cut this prompt. That should not happen: please report it.";

export function cutNote(span: CutFields, planned = false): { text: string; warn: boolean } | null {
  const cut = span.prompt_cut ?? null;
  if (planned && (cut === "yes" || cut === "likely")) return { text: PLANNED_CUT_NOTE, warn: true };
  const count = span.dropped_message_ids?.length ?? 0;
  const tokens = span.dropped_tokens ?? null;
  const size = tokens === null ? "" : ` (≈${formatTokens(tokens)})`;
  if (cut === "yes") {
    const head = "Ollama dropped older messages to fit the window.";
    return { text: count === 0 ? head : `${head} About ${count}${size} ${count === 1 ? "was" : "were"} not seen.`, warn: true };
  }
  if (cut === "likely" && span.prompt_cut_kind === "middle") {
    return {
      text: "The system prompt and tools alone did not fit, so Ollama probably cut the prompt in the middle. This answer is not reliable.",
      warn: true,
    };
  }
  if (cut === "likely" && span.prompt_cut_kind === "older_messages") {
    const text =
      count === 0
        ? "Ollama probably dropped older messages to fit the window."
        : `Ollama probably dropped about ${count} older ${count === 1 ? "message" : "messages"}${size} to fit the window.`;
    return { text, warn: false };
  }
  return null;
}

/** The muted legend row for cleared results: `Cleared · 12 tool results · 11.2K not sent`, or null. */
export function clearedLegend(context: Pick<TraceContext, "cleared">): string | null {
  const count = context.cleared?.count ?? 0;
  if (count <= 0) return null;
  return `${CONTEXT_LABELS.cleared} · ${plural(count, "tool result", "tool results")} · ${formatTokens(context.cleared?.tokens ?? 0)} not sent`;
}

/** What was cleared at one model call: a line for the Context tab, or null when nothing was. */
export function clearedNote(context: Pick<TraceContext, "cleared">): string | null {
  const count = context.cleared?.count ?? 0;
  const tokens = context.cleared?.tokens ?? 0;
  if (count <= 0) return null;
  return `${count} old tool ${count === 1 ? "result was" : "results were"} sent as one line at this call, saving ≈${formatTokens(tokens)}.`;
}

/** The line for the summary message of a call: `summary of 9 earlier messages`. */
export function summaryOfLine(count: number): string {
  return `summary of ${plural(count, "earlier message", "earlier messages")}`;
}

/** What `context.changed` carries. */
export type ContextChangeData = Extract<ChatEvent, { type: "context.changed" }>["data"];

/**
 * The one quiet line for a change of what golem sends: `golem cleared 12 old tool results · ctx 71% → 38%`,
 * `golem summarised 9 earlier turns · ctx 84% → 31%`, or `window grew 32K → 64K · reloaded in 8 s`.
 * Percentages are of the room (window less the reply reserve), or tokens when the room is unknown.
 */
export function contextChangedNote(data: ContextChangeData): string {
  if (data.action === "grew") {
    const from = data.window_from ?? null;
    const to = data.window_to ?? null;
    const sizes = from === null || to === null ? "" : ` ${formatWindow(from)} → ${formatWindow(to)}`;
    const reload = data.reload_ms == null ? "" : ` · reloaded in ${data.reload_ms < 60_000 ? `${Math.round(data.reload_ms / 1000)} s` : formatTurnTime(data.reload_ms)}`;
    return `window grew${sizes}${reload}`;
  }
  const what =
    data.action === "cleared"
      ? plural(data.count ?? 0, "old tool result", "old tool results")
      : plural(data.count ?? 0, "earlier turn", "earlier turns");
  const head = `golem ${data.action} ${what}`;
  if (data.before_tokens == null || data.after_tokens == null) return head;
  const room = data.room ?? null;
  const share = (tokens: number): string => (room === null || room <= 0 ? formatTokens(tokens) : `${Math.round((tokens / room) * 100)}%`);
  return `${head} · ctx ${share(data.before_tokens)} → ${share(data.after_tokens)}`;
}

/** A cell of the bar: a part, the free rest, or the reply reserve at its end. */
export type ContextCell = ContextKey | "free" | "reserve";

/** The free tokens outside the reserve, and the reserve, of a call whose window is known. */
export function contextRoom(ctx: TraceContext): { free: number; reserve: number } | null {
  const window = ctx.window ?? null;
  if (window === null) return null;
  const left = Math.max(0, window - contextUsed(ctx));
  const reserve = Math.min(ctx.reserve ?? 0, left);
  return { free: left - reserve, reserve };
}

/**
 * Cells of a bar `width` wide for each part, in display order, then the free rest, then the reply
 * `reserve` (tokens) when there is one.
 */
export function contextCells(
  parts: readonly TraceContextPart[],
  window: number | null,
  width: number,
  reserve = 0,
): { key: ContextCell; cells: number }[] {
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
  const kept = Math.min(Math.max(0, width - taken), Math.round((Math.min(reserve, Math.max(0, total - used)) / total) * width));
  const out: { key: ContextCell; cells: number }[] = [
    ...CONTEXT_KEYS.map((key, index) => ({ key, cells: cells[index] ?? 0 })),
    { key: "free" as const, cells: Math.max(0, width - taken - kept) },
  ];
  if (kept > 0) out.push({ key: "reserve", cells: kept });
  return out;
}

/** `█` for each used cell, then `░` for each free one. */
export function contextBar(parts: readonly TraceContextPart[], window: number | null, width: number, reserve = 0): string {
  return contextCells(parts, window, width, reserve)
    .map(({ key, cells }) => (key === "free" ? "░" : key === "reserve" ? "▒" : "█").repeat(cells))
    .join("");
}

/** The context of the latest model call that reported its input tokens. */
export type LiveContext = {
  spanId: string;
  used: number;
  window: number | null;
  windowEstimated: boolean;
  windowPlanned: boolean;
  numCtx: number | null;
  /** Set when a clear or a summary moved `used` after that call: the call's own messages are out of date. */
  adjusted?: true;
};

/** `pending` is the call that started and has not ended: its window waits for its usage. */
export type LiveContextState = {
  last: LiveContext | null;
  pending: { spanId: string; window: number | null; windowEstimated: boolean; windowPlanned: boolean; numCtx: number | null } | null;
};

export const emptyLiveContext: LiveContextState = { last: null, pending: null };

/**
 * Fold one event into the live context. A call that ends with no usage keeps the previous `last`.
 * A clear or a summary lowers `used` by what it freed, so the chip drops before the next call.
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
        windowPlanned: event.data.window_planned ?? false,
        numCtx: event.data.num_ctx ?? null,
      },
    };
  }
  if (event.type === "context.changed") {
    const { action, before_tokens: before, after_tokens: after } = event.data;
    if (state.last === null || action === "grew" || before == null || after == null) return state;
    return { ...state, last: { ...state.last, used: Math.max(0, state.last.used - Math.max(0, before - after)), adjusted: true } };
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
    return { last: { spanId: pending.spanId, used: input, window, windowEstimated, windowPlanned: pending.windowPlanned, numCtx: pending.numCtx }, pending: null };
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
export type ContextLine = { text: string; part?: ContextKey | "free" | "reserve" | "cleared" }[];

/** The panel's grid: rows of cells, the parts in display order, then the free ones. One cell is 0.5% of the window. */
export function contextGrid(
  parts: readonly TraceContextPart[],
  window: number | null,
  rows = 10,
  cols = 20,
  reserve = 0,
): ContextCell[][] {
  const flat = contextCells(parts, window, rows * cols, reserve).flatMap(({ key, cells }) => Array.from({ length: cells }, () => key));
  return Array.from({ length: rows }, (_, row) => flat.slice(row * cols, (row + 1) * cols));
}

const GRID_WIDTH = 40;
const GRID_GAP = "   ";
/** The least width that holds the grid and the legend side by side. */
const SIDE_BY_SIDE = 84;

function gridLine(cells: readonly ContextCell[]): ContextLine {
  const line: ContextLine = [];
  for (const key of cells) {
    const glyph = key === "free" ? "\u25A1 " : key === "reserve" ? "\u25A8 " : "\u25A0 ";
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
    const room = contextRoom(ctx);
    const cells = contextGrid(ctx.parts, window, 10, 20, room?.reserve ?? 0).map(gridLine);
    const head: ContextLine[] = [];
    if (report.model !== null) head.push(plain(report.model));
    head.push(plain(summary), plain(""));
    const legend: ContextLine[] = ctx.parts
      .filter((part) => part.tokens > 0)
      .map((part): ContextLine => [{ text: "\u25A0 ", part: part.key }, { text: row(CONTEXT_LABELS[part.key], part.tokens) }]);
    if (used <= window) {
      legend.push([{ text: "\u25A1 ", part: "free" }, { text: row(CONTEXT_LABELS.free, room?.free ?? window - used) }]);
      if (room !== null && room.reserve > 0) {
        legend.push([{ text: "\u25A8 ", part: "reserve" }, { text: row(CONTEXT_LABELS.reserve, room.reserve) }]);
      }
    }
    const cleared = clearedLegend(ctx);
    if (cleared !== null) legend.push([{ text: "\u25A8 ", part: "cleared" }, { text: cleared }]);
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
    for (const part of ctx.parts.filter((p) => p.key !== "summary" || p.tokens > 0)) {
      lines.push(plain(row(CONTEXT_LABELS[part.key], part.tokens)));
      if (part.key === "tools") lines.push(...servers);
    }
  }
  if (!grid) {
    const cleared = clearedLegend(ctx);
    if (cleared !== null) lines.push(plain(cleared));
  }
  if (grid) lines.push(...servers);
  if (ctx.estimated) lines.push(plain("Parts are estimates, scaled to the provider's count."));
  if (window !== null && ctx.window_estimated === true) {
    lines.push(plain("The window is estimated: golem read it from Ollama. It was not sent."));
  }
  if (window === null) lines.push(plain(windowUnknownHint(report.provider ?? null)));
  const note = cutNote(ctx);
  if (note !== null) lines.push(plain(`${note.warn ? "! " : ""}${note.text}`));
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
