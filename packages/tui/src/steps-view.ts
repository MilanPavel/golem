import type { ChatEvent } from "@golem/client";
import {
  batchCard,
  emptyChat,
  helperBanner,
  helperLimits,
  helperPanelState,
  helperReceipt,
  helperSteps,
  helperSummary,
  isTrimmedHelper,
  withLocal,
  type BarKind,
  type CardTone,
  type ChatState,
  type HelperBanner,
  type HelperBatch,
  type HelperRef,
  type IsLocal,
  type StepRow,
} from "@golem/view";

import { fitRow, toneSpan } from "./helper-tree.ts";
import type { Press } from "./keys.ts";
import { layoutMessages, type Span } from "./layout-chat.ts";

/**
 * Steps, full screen (ticket 15.7.8, ADR-059): the helper batches of this chat (`/steps`), the steps of one
 * batch with a time bar per helper, and one helper's chat read-only. Pure: the state says where the user is,
 * the app holds the lead's events and the helper's own log, and `helper-chat.tsx` only draws the lines.
 */

export type HelperChatMode = "summary" | "everything";

export type StepsView =
  | { kind: "list"; selected: number }
  /** `fromList` says Esc goes back to the list, not out of the screen. */
  | { kind: "steps"; callId: string; selected: number; fromList: boolean }
  /** `offset` counts rows from the top of the body. */
  | { kind: "chat"; callId: string; index: number; mode: HelperChatMode; offset: number; fromList: boolean };

export type StepsManagerState = { open: boolean; view: StepsView };

export const closedStepsManager: StepsManagerState = { open: false, view: { kind: "list", selected: 0 } };

/** `/steps` opens the list. Enter on an empty composer opens the Steps of that batch at once. */
export function openStepsManager(callId: string | null = null): StepsManagerState {
  return {
    open: true,
    view: callId === null ? { kind: "list", selected: 0 } : { kind: "steps", callId, selected: 0, fromList: false },
  };
}

export type StepsKey = "up" | "down" | "enter" | "back" | "stop" | "mode" | "page-up" | "page-down";

export type StepsAction =
  | { kind: "none" }
  | { kind: "close" }
  /** Attach to the helper's session and show its chat. */
  | { kind: "open-chat"; callId: string; index: number }
  /** The chat closed: stop following the helper. */
  | { kind: "leave-chat"; callId: string; index: number }
  | { kind: "stop"; callId: string; index: number };

export function stepsKeyOf(press: Press): StepsKey | null {
  if (press.name === "up" || press.name === "down" || press.name === "page-up" || press.name === "page-down") return press.name;
  if (press.name === "return") return "enter";
  if (press.name === "escape") return "back";
  if (press.name === "tab") return "mode";
  return press.name === null && press.input === "x" && !press.ctrl && !press.meta ? "stop" : null;
}

/** What the keys need to know about the data. */
export type StepsContext = {
  /** Call ids of the batches, newest first. */
  order: readonly string[];
  /** The helpers of a batch in the order the Steps list shows them. `live` is false once one ended. */
  helpers: (callId: string) => readonly { index: number; live: boolean }[];
  /** The furthest the chat body scrolls, in rows from the top. */
  chatMax: number;
};

const NONE: StepsAction = { kind: "none" };
const PAGE = 10;

function clamp(value: number, count: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, count - 1));
}

export function pressStepsManager(
  state: StepsManagerState,
  context: StepsContext,
  key: StepsKey,
): { state: StepsManagerState; action: StepsAction } {
  const view = state.view;
  const to = (next: StepsView, action: StepsAction = NONE) => ({ state: { ...state, view: next }, action });
  if (view.kind === "list") {
    const selected = clamp(view.selected, context.order.length);
    if (key === "back") return { state: closedStepsManager, action: { kind: "close" } };
    if (key === "up" || key === "down") return to({ kind: "list", selected: clamp(selected + (key === "up" ? -1 : 1), context.order.length) });
    const callId = context.order[selected];
    if (key === "enter" && callId !== undefined) return to({ kind: "steps", callId, selected: 0, fromList: true });
    return { state, action: NONE };
  }
  const helpers = context.helpers(view.callId);
  if (view.kind === "steps") {
    const selected = clamp(view.selected, helpers.length);
    const picked = helpers[selected];
    if (key === "back") {
      if (view.fromList) {
        const at = context.order.indexOf(view.callId);
        return to({ kind: "list", selected: Math.max(0, at) });
      }
      return { state: closedStepsManager, action: { kind: "close" } };
    }
    if (key === "up" || key === "down") return to({ ...view, selected: clamp(selected + (key === "up" ? -1 : 1), helpers.length) });
    if (key === "enter" && picked !== undefined) {
      return to(
        { kind: "chat", callId: view.callId, index: picked.index, mode: "summary", offset: 0, fromList: view.fromList },
        { kind: "open-chat", callId: view.callId, index: picked.index },
      );
    }
    if (key === "stop" && picked !== undefined && picked.live) return { state, action: { kind: "stop", callId: view.callId, index: picked.index } };
    return { state, action: NONE };
  }
  const here = helpers.findIndex((item) => item.index === view.index);
  if (key === "back") {
    return to(
      { kind: "steps", callId: view.callId, selected: Math.max(0, here), fromList: view.fromList },
      { kind: "leave-chat", callId: view.callId, index: view.index },
    );
  }
  if (key === "mode") return to({ ...view, mode: view.mode === "summary" ? "everything" : "summary", offset: 0 });
  if (key === "stop") {
    return helpers[here]?.live === true ? { state, action: { kind: "stop", callId: view.callId, index: view.index } } : { state, action: NONE };
  }
  const step = key === "up" ? -1 : key === "down" ? 1 : key === "page-up" ? -PAGE : key === "page-down" ? PAGE : 0;
  if (step === 0) return { state, action: NONE };
  return to({ ...view, offset: Math.min(Math.max(0, view.offset + step), Math.max(0, context.chatMax)) });
}

/** Call ids of the batches, newest first. A record keeps the order the calls were made in. */
export function batchOrder(batches: Readonly<Record<string, HelperBatch>>): string[] {
  return Object.keys(batches).reverse();
}

// ----- the time bar -----

const BAR_CHAR: Record<BarKind, string> = { work: "█", line: "░", you: "▓" };

function barSpan(kind: BarKind, text: string): Span {
  return kind === "you" ? { text, warn: true } : kind === "line" ? { text, dim: true } : { text };
}

/**
 * A fixed-width bar for one row on the shared scale. Work is solid, waiting in line is light, waiting for
 * you is hatched in the warn colour. Every row gets at least one cell, so a short step still shows.
 */
export function barSpans(row: Pick<StepRow, "from" | "to" | "segments">, width: number): Span[] {
  const cells = Math.max(1, width);
  const first = Math.min(cells - 1, Math.floor(row.from * cells));
  const kinds: (BarKind | null)[] = [];
  for (let cell = 0; cell < cells; cell += 1) {
    const lo = cell / cells;
    const hi = (cell + 1) / cells;
    const inside = row.from < hi && row.to > lo;
    if (!inside && cell !== first) {
      kinds.push(null);
      continue;
    }
    let best: BarKind | null = null;
    let most = 0;
    for (const segment of row.segments) {
      const overlap = Math.min(hi, segment.to) - Math.max(lo, segment.from);
      if (overlap > most) {
        most = overlap;
        best = segment.kind;
      }
    }
    kinds.push(best ?? row.segments[0]?.kind ?? "work");
  }
  const out: Span[] = [];
  let run = 0;
  for (let cell = 0; cell < kinds.length; cell += 1) {
    const kind = kinds[cell] ?? null;
    run += 1;
    if (cell + 1 < kinds.length && (kinds[cell + 1] ?? null) === kind) continue;
    out.push(kind === null ? { text: " ".repeat(run) } : barSpan(kind, BAR_CHAR[kind].repeat(run)));
    run = 0;
  }
  return out;
}

// ----- rows -----

export type StepsLine = { spans: readonly Span[]; selected?: boolean };

/** The rows of one batch's Steps: the lead's own row, then a row per helper. */
export function stepRows(callId: string, events: readonly ChatEvent[], nowMs: number, isLocal?: IsLocal): StepRow[] {
  return helperSteps(callId, events, nowMs, { isLocal, length: "tui", lead: { label: "lead" } }).rows;
}

/** The helper index a row of `stepRows` stands for, or null for the lead's row. */
export function helperIndexOf(row: Pick<StepRow, "id" | "role">): number | null {
  if (row.role !== "helper") return null;
  const index = Number(row.id.slice(row.id.lastIndexOf(":") + 1));
  return Number.isInteger(index) ? index : null;
}

function toneMark(tone: CardTone): Span {
  switch (tone) {
    case "run":
      return { text: "■", color: "green" };
    case "ok":
      return { text: "✓", color: "green" };
    case "bad":
      return { text: "✗", color: "red" };
    case "wait":
      return { text: "□", warn: true };
  }
}

function size(text: string): number {
  return [...text].length;
}

function pad(text: string, width: number): string {
  const missing = width - size(text);
  return missing > 0 ? text + " ".repeat(missing) : text;
}

function cut(text: string, room: number): string {
  if (size(text) <= room) return text;
  return room <= 0 ? "" : `${[...text].slice(0, room - 1).join("")}…`;
}

const STEPS_HINT = "↑/↓ choose · Enter opens its chat · x stops it · Esc back";
const LIST_HINT = "↑/↓ choose · Enter opens Steps · Esc close";
const CHAT_HINT = "↑/↓ scroll · Tab Summary or Everything · x stops it · Esc back";
const LEGEND: readonly Span[] = [
  { text: "█" },
  { text: " working   " },
  { text: "░", dim: true },
  { text: " in line   " },
  { text: "▓", warn: true },
  { text: " waiting for you" },
];

/** The Steps of one batch: a line per row with its bar, the scale under it. */
export function stepsLines(rows: readonly StepRow[], selected: number, columns: number, spanMs: number): StepsLine[] {
  const labelWidth = Math.min(14, Math.max(4, ...rows.map((row) => size(row.label))));
  const rightWidth = Math.max(0, ...rows.map((row) => size(row.right)));
  const tookWidth = Math.max(0, ...rows.map((row) => size(row.took)));
  const fixed = 2 + 2 + labelWidth + 2 + 2 + rightWidth + 2 + tookWidth;
  const bar = Math.max(4, columns - fixed);
  let helperAt = -1;
  const lines: StepsLine[] = rows.map((row) => {
    const isHelper = row.role === "helper";
    if (isHelper) helperAt += 1;
    const chosen = isHelper && helperAt === selected;
    const spans: Span[] = [
      { text: chosen ? "❯ " : "  ", bold: chosen },
      toneMark(row.tone),
      { text: " " },
      { text: pad(cut(row.label, labelWidth), labelWidth), bold: chosen || !isHelper },
      { text: "  " },
      ...barSpans(row, bar),
      { text: "  " },
      toneSpan(pad(row.right, rightWidth), row.tone),
      { text: `  ${pad(row.took, tookWidth)}`, dim: true },
    ];
    return { spans, selected: chosen };
  });
  const total = rows.length === 0 ? "" : `on a scale of ${formatSpan(spanMs)}`;
  return [...lines, { spans: [] }, { spans: [...LEGEND, { text: total === "" ? "" : `   ${total}`, dim: true }] }];
}

function formatSpan(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${String(seconds)}s` : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** The list of batches, newest first: the head of each card and how it stands. */
export function batchListLines(
  batches: Readonly<Record<string, HelperBatch>>,
  order: readonly string[],
  selected: number,
  columns: number,
  isLocal?: IsLocal,
): StepsLine[] {
  const lines: StepsLine[] = [];
  for (const [index, callId] of order.entries()) {
    const found = batches[callId];
    if (found === undefined) continue;
    const card = batchCard(isLocal === undefined ? found : withLocal(found, isLocal), "quiet", "tui");
    const chosen = index === selected;
    const lead: Span[] = [{ text: chosen ? "❯ " : "  ", bold: chosen }];
    lines.push({ spans: fitRow(lead, card.total ?? card.head, "", [toneSpan(card.right, card.tone)], columns), selected: chosen });
  }
  return lines;
}

// ----- a helper's chat -----

/** Words wrapped to `width`, a blank row kept between paragraphs. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter((part) => part !== "")) {
      if (current !== "" && size(current) + 1 + size(word) > width) {
        out.push(current);
        current = word;
      } else {
        current = current === "" ? word : `${current} ${word}`;
      }
    }
    out.push(current);
  }
  return out;
}

function section(title: string, text: string | null, width: number): StepsLine[] {
  if (text === null || text === "") return [];
  return [
    { spans: [{ text: title, bold: true }] },
    ...wrap(text, Math.max(10, width - 2)).map((part): StepsLine => ({ spans: [{ text: `  ${part}` }] })),
    { spans: [] },
  ];
}

/** What a helper's Summary says, from its own log: the brief, its calls, what it does now, its question, its answer. */
export function summaryLines(chat: ChatState, width: number): StepsLine[] {
  const summary = helperSummary(chat);
  const lines = [
    ...section("Asked", summary.brief, width),
    ...section("Calls", summary.calls, width),
    ...section("Doing now", summary.latest, width),
    ...section("Asks you", summary.question, width),
    ...section("Answer", summary.answer, width),
    ...(summary.hidden === null ? [] : [{ spans: [{ text: `Left out: ${summary.hidden}`, dim: true }] } as StepsLine]),
  ];
  return lines.length === 0 ? [{ spans: [{ text: "Nothing yet.", dim: true }] }] : lines;
}

/** Everything the helper said and did, laid out as the lead's chat is. */
export function everythingLines(chat: ChatState, width: number, nowMs: number): StepsLine[] {
  const laid = layoutMessages(chat.messages, Math.max(1, width), { times: false, now: nowMs });
  return laid.length === 0 ? [{ spans: [{ text: "Nothing yet.", dim: true }] }] : laid.map((line) => ({ spans: line.spans }));
}

/** The body of a helper's chat in the chosen mode. */
export function helperChatBody(chat: ChatState, mode: HelperChatMode, width: number, nowMs: number): StepsLine[] {
  return mode === "summary" ? summaryLines(chat, width) : everythingLines(chat, width, nowMs);
}

/** A helper's own log as the app holds it. `error` is set when the session could not be read. */
export type HelperChatData = { sessionId: string; chat: ChatState; error: string | null };

export type StepsLayoutInput = {
  state: StepsManagerState;
  batches: Readonly<Record<string, HelperBatch>>;
  events: readonly ChatEvent[];
  /** The helpers of a batch, from the lead's log. */
  refs: (callId: string) => readonly HelperRef[];
  /** The open helper's own log, or null before it arrives. */
  helper: HelperChatData | null;
  /** When the daemon trimmed the open helper to its receipt, from the session list. Null or left out when it did not. */
  trimmedAt?: string | null;
  /** The lead's title, for the breadcrumb. */
  lead: string;
  now: number;
  columns: number;
  rows: number;
  isLocal?: IsLocal;
};

/** The helpers of a batch, in Steps order, with whether each still runs. */
export function stepsHelpers(callId: string, events: readonly ChatEvent[], nowMs: number, isLocal?: IsLocal): { index: number; live: boolean }[] {
  const out: { index: number; live: boolean }[] = [];
  for (const row of stepRows(callId, events, nowMs, isLocal)) {
    const index = helperIndexOf(row);
    if (index !== null) out.push({ index, live: row.running });
  }
  return out;
}

/** When the daemon trimmed session `id` to its receipt, from the session list. Null for a helper that is whole, and for an older daemon. */
export function trimmedAtOf(sessions: readonly { session_id: string; trimmed_at?: string | null }[], id: string | undefined): string | null {
  const found = id === undefined ? undefined : sessions.find((item) => item.session_id === id);
  return found !== undefined && isTrimmedHelper(found) ? (found.trimmed_at ?? null) : null;
}

/** The header line of a helper's chat: `Helper of <lead title> · <agent> · <model> · running`. */
export function bannerLine(banner: HelperBanner): string {
  return [`Helper of ${banner.lead === null || banner.lead === "" ? "this chat" : banner.lead}`, banner.agent, banner.model, banner.running ? "running" : null]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** What a trimmed helper keeps, drawn in place of its steps: the brief, how it ended, when the steps went, where the answer is. */
export function receiptLines(chat: ChatState, ref: HelperRef | undefined, trimmedAt: string, width: number): StepsLine[] {
  const receipt = helperReceipt({ ref, chat, trimmedAt });
  return [
    { spans: [{ text: "Receipt", bold: true }] },
    ...section("Asked", receipt.brief, width),
    { spans: [{ text: [receipt.outcome, ...receipt.facts].join(" · ") }] },
    ...(receipt.removed === null ? [] : [{ spans: [{ text: receipt.removed, dim: true }] } as StepsLine]),
    { spans: [{ text: receipt.answerNote, dim: true }] },
  ];
}

/** The scroll limit of the open helper's chat body, for the keys. */
export function chatBodyRoom(rows: number): number {
  return Math.max(1, rows - 5);
}

export function chatScrollMax(input: Pick<StepsLayoutInput, "state" | "helper" | "now" | "columns" | "rows" | "trimmedAt">): number {
  const view = input.state.view;
  if (view.kind !== "chat" || input.helper === null || (input.trimmedAt ?? null) !== null) return 0;
  const body = helperChatBody(input.helper.chat, view.mode, input.columns, input.now);
  return Math.max(0, body.length - chatBodyRoom(input.rows));
}

/** The whole screen, `rows` lines, the last one the hint. */
export function layoutStepsManager(input: StepsLayoutInput): StepsLine[] {
  const { state, columns, rows } = input;
  const width = Math.max(1, columns);
  const view = state.view;
  let head: StepsLine[];
  let body: StepsLine[];
  let hint = LIST_HINT;
  if (view.kind === "list") {
    const order = batchOrder(input.batches);
    head = [
      { spans: [{ text: "Steps", bold: true }] },
      { spans: [{ text: order.length === 0 ? "no helpers ran in this chat" : `${String(order.length)} ${order.length === 1 ? "run" : "runs"} of helpers, newest first`, dim: true }] },
      { spans: [] },
    ];
    body = batchListLines(input.batches, order, clamp(view.selected, order.length), width, input.isLocal);
  } else if (view.kind === "steps") {
    const batch = input.batches[view.callId];
    const list = helperSteps(view.callId, input.events, input.now, { isLocal: input.isLocal, length: "tui", lead: { label: "lead" } });
    const card = batch === undefined ? null : batchCard(input.isLocal === undefined ? batch : withLocal(batch, input.isLocal), "quiet", "tui");
    head = [
      { spans: [{ text: `Steps · ${input.lead === "" ? "this chat" : input.lead}`, bold: true }] },
      { spans: [{ text: card === null ? "" : card.total ?? card.head, dim: true }] },
      { spans: [] },
    ];
    const helpers = list.rows.filter((row) => row.role === "helper").length;
    body = stepsLines(list.rows, clamp(view.selected, helpers), width, list.spanMs);
    hint = STEPS_HINT;
  } else {
    const ref = input.refs(view.callId).find((item) => item.index === view.index);
    const trimmedAt = input.trimmedAt ?? null;
    const named = helperBanner({ lead: input.lead, ref, chat: input.helper?.chat ?? emptyChat });
    const phase = ref !== undefined && input.helper !== null ? helperPanelState(ref, input.helper.chat) : null;
    const limits = ref !== undefined && input.helper !== null && trimmedAt === null ? helperLimits(ref, input.helper.chat, input.now) : "";
    head = [
      { spans: [{ text: bannerLine(named), bold: true }] },
      {
        spans: [
          { text: trimmedAt !== null ? "read-only · receipt" : `read-only · ${view.mode === "summary" ? "Summary" : "Everything"}`, dim: true },
          { text: phase === null ? "" : ` · ${phase}`, dim: true },
          { text: limits === "" ? "" : ` · ${limits}`, dim: true },
        ],
      },
      { spans: [] },
    ];
    if (input.helper === null) {
      body = [{ spans: [{ text: "asking the daemon…", dim: true }] }];
    } else if (input.helper.error !== null) {
      body = [{ spans: [{ text: input.helper.error }] }];
    } else if (trimmedAt !== null) {
      body = receiptLines(input.helper.chat, ref, trimmedAt, width);
    } else {
      const all = helperChatBody(input.helper.chat, view.mode, width, input.now);
      const room = chatBodyRoom(rows);
      const start = Math.min(view.offset, Math.max(0, all.length - room));
      body = all.slice(start, start + room);
    }
    hint = CHAT_HINT;
  }
  const room = Math.max(0, rows - head.length - 2);
  const lines = [...head, ...body.slice(0, room), { spans: [] }, { spans: [{ text: hint, dim: true }] }];
  return lines.slice(0, Math.max(0, rows)).map((line) => ({ ...line, spans: clipSpans(line.spans, width) }));
}

/** The spans cut to `width` characters. */
function clipSpans(spans: readonly Span[], width: number): Span[] {
  const out: Span[] = [];
  let left = width;
  for (const span of spans) {
    if (left <= 0) break;
    const length = size(span.text);
    out.push(length <= left ? span : { ...span, text: [...span.text].slice(0, left).join("") });
    left -= length;
  }
  return out;
}
