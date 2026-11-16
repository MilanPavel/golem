import type { SkillCall } from "@golem/client";
import { Lexer, type Token, type Tokens } from "marked";

import {
  changesRow,
  diffCounts,
  diffExcerpt,
  formatDuration,
  parseDiff,
  planFooter,
  planOfCall,
  PROPOSE_PLAN_TOOL,
  REPLY_CUT_NOTE,
  thinkingLine,
  turnFooterParts,
  turnOf,
  turnTotals,
  visibleText,
  writingLabel,
  type ChangesState,
  type ChatMessage,
  type Detail,
  type DiffExcerpt,
  type DiffLine,
  type PlanStepView,
  type ToolBlock,
} from "@golem/view";
import { formatMessageTime } from "./transcript.ts";

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  dim?: boolean;
  /** A row of a diff: drawn green or red on a tinted background. */
  tone?: "add" | "del";
  /** Drawn yellow: a file the model is still writing. */
  warn?: boolean;
};

export type LineRole = "user" | "assistant" | "plain";

/** What a wrap took out between a row and the one above it: a space, or nothing in a cut word. */
export type Joint = " " | "";

export type LayoutLine = {
  role: LineRole;
  spans: readonly Span[];
  /** Set when this row only continues the line above, so a copy joins them with this. */
  joins?: Joint;
  /** On the `you` row of a question: the question's first line, shown pinned while it is scrolled off. */
  asks?: string;
};

export type Viewport = {
  lines: LayoutLine[];
  overflow: boolean;
  offsetFromBottom: number;
};

/** The question whose answer fills the window, drawn above `lines` while its own rows are scrolled off. */
export type PinnedQuestion = {
  line: LayoutLine;
  /** The offset that brings the question's `you` row to the top of the window. */
  offset: number;
};

export type Transcript = Viewport & {
  /** Row 0 of the window when set. `lines` and `gutter` then start one row lower. */
  pinned: PinnedQuestion | null;
  /** One mark per row of the window, the pinned row included. */
  gutter: readonly string[] | null;
  lineCount: number;
  /** Every row at the width shown, top to bottom. `lines` is the window onto it. */
  all: readonly LayoutLine[];
};

export type TranscriptOptions = {
  times: boolean;
  now: number;
  /** Ctrl-O: draw each tool call's output, each skill's body, and each reply's thinking under its line. */
  toolOutput?: boolean;
  /** `/thinking`: false hides the thinking line. Unset shows it. */
  thinking?: boolean;
  /** How many diff rows an edit shows under its line: none, 10 or 30. Unset is `normal`. */
  detail?: Detail;
  /** Whole seconds since the first `tool.writing` of the call a reply is writing. Unset counts 0. */
  writingSeconds?: (messageId: string) => number;
  /** The files each turn changed. With it, a finished turn that changed files ends in one summary row. */
  changes?: ChangesState;
  /** The run still going. Its turn gets no summary row yet. */
  liveRunId?: string | null;
  /** The slash commands that exist, so the summary row names only those. Unset names none. */
  commands?: readonly string[];
};

/** Output rows shown per tool call while Ctrl-O is on. */
export const TOOL_PREVIEW_ROWS = 12;

const TOOL_MARKS: Record<ToolBlock["status"], string> = {
  requested: "…",
  waiting: "?",
  running: "…",
  done: "✓",
  failed: "✗",
};

export const INTERRUPTED_MARK = "· interrupted";

export function layoutMessages(
  messages: readonly ChatMessage[],
  columns: number,
  options?: TranscriptOptions,
): LayoutLine[] {
  const width = Math.max(1, columns);
  const lines: LayoutLine[] = [];
  let previous: ChatMessage | undefined;
  let runStart = 0;
  for (const [index, message] of messages.entries()) {
    const continues = previous?.role === "assistant" && message.role === "assistant";
    if (!continues) {
      runStart = index;
    }
    previous = message;
    if (lines.length > 0 && !continues) {
      lines.push({ role: "plain", spans: [{ text: "" }] });
    }
    const role: LineRole = message.role === "user" ? "user" : "assistant";
    const label = role === "user" ? "you" : "golem";
    const tools = message.tools ?? [];
    const body =
      message.skill !== undefined
        ? skillLines(message.skill, message.text, width, options?.toolOutput === true)
        : tools.length > 0 && message.text.length === 0
          ? []
          : message.streaming
            ? wrapSpans([{ text: message.text }], width)
            : markdownLines(message.text, width);
    if (!continues) {
      const head: LayoutLine = { role, spans: labelSpans(label, message, options) };
      lines.push(paint(role === "user" ? { ...head, asks: firstLine(message.text) } : head, width));
    }
    for (const spans of options?.thinking === false ? [] : thinkingLines(message, width, options?.toolOutput === true)) {
      lines.push(wrappedLine(role, spans));
    }
    for (const spans of body) {
      lines.push(paint(wrappedLine(role, spans), width));
    }
    for (const tool of tools) {
      for (const spans of toolLines(tool, width, options?.toolOutput === true, options?.detail)) {
        lines.push(wrappedLine(role, spans));
      }
    }
    if (message.writing != null) {
      const label = writingLabel(message.writing, options?.writingSeconds?.(message.id) ?? 0);
      for (const spans of wrapSpans([{ text: `◐ ${label}`, warn: true }], width)) {
        lines.push(wrappedLine(role, spans));
      }
    }
    const duration = tools.length > 0 ? null : answerDuration(message, messages.slice(runStart, index + 1));
    if (duration !== null) {
      lines.push(paint({ role, spans: [{ text: duration, dim: true }] }, width));
    }
    if (message.cut === true) {
      lines.push(paint({ role, spans: [{ text: REPLY_CUT_NOTE, dim: true }] }, width));
    }
    if (message.interrupted === true) {
      lines.push(paint({ role, spans: [{ text: INTERRUPTED_MARK, italic: true }] }, width));
    }
    const next = messages[index + 1];
    if (
      options?.changes !== undefined &&
      message.role === "assistant" &&
      message.runId !== undefined &&
      message.runId !== options.liveRunId &&
      !(next?.role === "assistant" && next.runId === message.runId)
    ) {
      const row = changesRow(turnOf(options.changes, message.runId), width, options.commands ?? []);
      if (row.length > 0) {
        for (const spans of wrapSpans([{ text: row, dim: true }], width)) {
          lines.push(wrappedLine(role, spans));
        }
      }
    }
  }
  return lines;
}

export function fitViewport(
  lines: readonly LayoutLine[],
  bodyRows: number,
  offsetFromBottom: number,
): Viewport {
  const rows = Math.max(0, Math.floor(bodyRows));
  if (rows === 0) {
    return { lines: [], overflow: lines.length > 0, offsetFromBottom: 0 };
  }
  if (lines.length <= rows) {
    return { lines: [...lines], overflow: false, offsetFromBottom: 0 };
  }
  const maxOffset = lines.length - rows;
  const offset = Math.min(Math.max(0, Math.floor(offsetFromBottom)), maxOffset);
  const end = lines.length - offset;
  return {
    lines: lines.slice(end - rows, end),
    overflow: true,
    offsetFromBottom: offset,
  };
}

export function gutterColumn(total: number, bodyRows: number, offsetFromBottom: number): string[] {
  const rows = Math.max(1, bodyRows);
  const maxOffset = Math.max(0, total - rows);
  const offset = Math.min(Math.max(0, offsetFromBottom), maxOffset);
  const fromTop = maxOffset - offset;
  const thumb = maxOffset === 0 ? rows - 1 : Math.round((fromTop / maxOffset) * (rows - 1));
  return Array.from({ length: rows }, (_, index) => (index === thumb ? "█" : "│"));
}

export function layoutTranscript(
  messages: readonly ChatMessage[],
  columns: number,
  bodyRows: number,
  offsetFromBottom: number,
  options?: TranscriptOptions,
): Transcript {
  const width = Math.max(1, columns);
  const full = layoutMessages(messages, width, options);
  const rows = Math.max(0, bodyRows);
  const overflows = rows > 0 && full.length > rows;
  const contentWidth = overflows ? Math.max(1, width - 1) : width;
  const lines = overflows ? layoutMessages(messages, contentWidth, options) : full;
  const whole = fitViewport(lines, rows, offsetFromBottom);
  const question = whole.overflow ? questionAbove(lines, lines.length - whole.offsetFromBottom - whole.lines.length) : -1;
  const fitted = question < 0 || rows < 2 ? whole : fitViewport(lines, rows - 1, whole.offsetFromBottom);
  const pinned =
    fitted === whole
      ? null
      : {
          line: pinnedLine(lines[question] as LayoutLine, contentWidth),
          offset: Math.max(0, lines.length - question - rows),
        };
  const shown = fitted.lines.length + (pinned === null ? 0 : 1);
  const gutter =
    fitted.overflow && shown > 0 ? gutterColumn(lines.length, shown, fitted.offsetFromBottom) : null;
  return { ...fitted, pinned, gutter, lineCount: lines.length, all: lines };
}

/**
 * The `you` row of the question above row `first`, or -1 when row `first`
 * starts a question itself or no question is above it.
 */
function questionAbove(lines: readonly LayoutLine[], first: number): number {
  if (lines[first]?.asks !== undefined) {
    return -1;
  }
  for (let index = first - 1; index >= 0; index -= 1) {
    if (lines[index]?.asks !== undefined) {
      return index;
    }
  }
  return -1;
}

/** `you  <first line of the question>`, cut to one row with `…`. */
function pinnedLine(head: LayoutLine, width: number): LayoutLine {
  const room = Math.max(0, width - 5);
  const asks = head.asks ?? "";
  const text = asks.length > room ? `${asks.slice(0, Math.max(0, room - 1))}…` : asks;
  return padLine({ role: "user", spans: [{ text: "you", bold: true }, { text: `  ${text}` }] }, width);
}

function firstLine(text: string): string {
  const line = text.split("\n").find((part) => part.trim().length > 0) ?? "";
  return visibleText(line.trim().replace(/\s+/g, " "));
}

/** The mark of a call that ran but did not succeed, such as `shell false`. */
export const UNSUCCESSFUL_MARK = "✗";

/** `read_file src/a.ts ✓  12 lines`, then the output while Ctrl-O is on. */
export function toolLines(tool: ToolBlock, width: number, expanded: boolean, detail: Detail = "normal"): Span[][] {
  const plan = tool.name === PROPOSE_PLAN_TOOL && tool.status !== "failed" ? planOfCall(tool.args) : null;
  if (plan !== null) {
    return planLines(plan, width);
  }
  if (isFinishedEdit(tool)) {
    return editLines(tool, tool.diff, width, expanded, detail);
  }
  const head: Span[] = [{ text: tool.name, bold: true }];
  const label = toolLabel(tool.args);
  if (label.length > 0) {
    head.push({ text: ` ${label}` });
  }
  const failed = tool.status === "failed" || (tool.status === "done" && tool.unsuccessful === true);
  const mark = tool.status === "done" && tool.unsuccessful === true ? UNSUCCESSFUL_MARK : TOOL_MARKS[tool.status];
  head.push({ text: ` ${mark}`, dim: !failed });
  if (tool.status === "done" && tool.summary !== undefined && tool.summary.length > 0) {
    head.push({ text: `  ${tool.summary}`, dim: true });
  }
  if (tool.status === "failed" && tool.error !== undefined) {
    head.push({ text: `  ${tool.error}`, italic: true });
  }
  const lines = wrapSpans(head, width);
  if (tool.status === "running" && tool.output !== undefined && tool.output.length > 0) {
    const live = tool.output.replace(/\n+$/, "").split("\n");
    for (const row of live.slice(expanded ? -TOOL_PREVIEW_ROWS : -1)) {
      lines.push(...wrapSpans([{ text: `  │ ${visibleText(row)}`, dim: true }], width));
    }
    return lines;
  }
  if (!expanded || tool.status !== "done" || tool.preview === undefined) {
    return lines;
  }
  const rows = tool.preview.split("\n");
  const shown = rows.slice(0, TOOL_PREVIEW_ROWS);
  for (const row of shown) {
    lines.push(...wrapSpans([{ text: `  │ ${visibleText(row)}`, dim: true }], width));
  }
  if (rows.length > shown.length || tool.truncated === true) {
    lines.push([{ text: "  │ …", dim: true }]);
  }
  if (tool.artifactId !== undefined) {
    lines.push(...wrapSpans([{ text: `  │ all of it: /artifact ${tool.artifactId}`, dim: true }], width));
  }
  return lines;
}

/**
 * A plan as rows, in place of the `propose_plan` call's line:
 * `◇ plan  title`, then each step numbered with its files dim, then the footer.
 */
export function planLines(plan: { title: string; steps: readonly PlanStepView[] }, width: number): Span[][] {
  const lines = wrapSpans([{ text: "◇ plan", warn: true }, { text: `  ${visibleText(plan.title)}`, bold: true }], width);
  const digits = String(plan.steps.length).length;
  for (const [index, step] of plan.steps.entries()) {
    const number = `${String(index + 1).padStart(digits)}. `;
    const spans: Span[] = [{ text: `  ${number}${visibleText(step.text)}` }];
    if (step.files.length > 0) {
      spans.push({ text: `  ${step.files.map(visibleText).join(" · ")}`, dim: true });
    }
    lines.push(...wrapSpans(spans, width));
  }
  lines.push(...wrapSpans([{ text: `  ${planFooter(plan)}`, dim: true }], width));
  return lines;
}

/** Diff rows shown under an edit by detail level, while Ctrl-O is off. */
export const DIFF_ROWS: Record<Detail, number> = { quiet: 0, normal: 10, verbose: 30 };

function isFinishedEdit(tool: ToolBlock): tool is ToolBlock & { diff: string } {
  return (
    (tool.name === "write_file" || tool.name === "edit_file") &&
    tool.status === "done" &&
    tool.unsuccessful !== true &&
    tool.diff !== undefined &&
    tool.diff.length > 0
  );
}

// A diff is parsed once per call: the transcript is laid out again on every paint.
type EditView = {
  diff: string;
  rows: DiffLine[];
  counts: ReturnType<typeof diffCounts>;
  excerpts: Map<number, DiffExcerpt>;
};
const EDITS = new Map<string, EditView>();
const EDITS_LIMIT = 200;
let parses = 0;

/** How many diffs were parsed for the transcript so far, for tests. */
export function diffParseCount(): number {
  return parses;
}

function editView(callId: string, diff: string): EditView {
  const hit = EDITS.get(callId);
  if (hit !== undefined && hit.diff === diff) {
    return hit;
  }
  if (EDITS.size >= EDITS_LIMIT) {
    EDITS.clear();
  }
  parses += 1;
  const all = parseDiff(diff);
  const view: EditView = {
    diff,
    rows: all.filter((line) => line.tone !== "meta"),
    counts: diffCounts(all),
    excerpts: new Map(),
  };
  view.excerpts.set(-1, diffExcerpt(all, Number.POSITIVE_INFINITY));
  EDITS.set(callId, view);
  return view;
}

function excerptOf(view: EditView, limit: number): DiffExcerpt {
  const hit = view.excerpts.get(limit);
  if (hit !== undefined) {
    return hit;
  }
  // The full excerpt holds every code row from its start, so a shorter one is a cut of it.
  const full = view.excerpts.get(-1) as DiffExcerpt;
  const lines = full.lines.slice(0, limit);
  const excerpt = { lines, more: full.lines.length - lines.length };
  view.excerpts.set(limit, excerpt);
  return excerpt;
}

/** `● edit src/a.py +18 −4`, then the first rows of the diff, or all of it while Ctrl-O is on. */
function editLines(tool: ToolBlock, diff: string, width: number, expanded: boolean, detail: Detail): Span[][] {
  const view = editView(tool.callId, diff);
  const counts = view.counts;
  const path = typeof tool.args.path === "string" ? visibleText(tool.args.path) : toolLabel(tool.args);
  const head: Span[] = [
    { text: "● ", dim: true },
    { text: counts.created ? "new" : "edit", bold: true },
    { text: ` ${path}` },
    { text: ` +${counts.added}`, tone: "add" },
  ];
  if (!counts.created) {
    head.push({ text: ` −${counts.deleted}`, tone: "del" });
  }
  const lines = wrapSpans(head, width);
  const limit = DIFF_ROWS[detail];
  if (limit === 0) {
    return lines;
  }
  const excerpt = expanded ? null : excerptOf(view, limit);
  const shown = excerpt === null ? view.rows : excerpt.lines;
  const more = excerpt === null ? 0 : excerpt.more;
  const room = Math.max(1, width - 1);
  for (const row of shown) {
    lines.push(diffRow(row, room));
  }
  if (more > 0) {
    lines.push([fitSpan({ text: `  … ${more} more ${more === 1 ? "line" : "lines"} · ctrl+o`, dim: true }, room)]);
  }
  return lines;
}

/** One diff row indented two columns, cut to `room` columns, and filled to them so the tint spans the row. */
function diffRow(row: DiffLine, room: number): Span[] {
  const tone = row.tone === "add" || row.tone === "del" ? row.tone : undefined;
  const text = fitSpan({ text: `  ${row.text}` }, room).text;
  if (tone === undefined) {
    return [{ text, dim: row.tone === "hunk" }];
  }
  return [{ text: text.padEnd(room), tone }];
}

function fitSpan(span: Span, room: number): Span {
  return span.text.length <= room ? span : { ...span, text: `${span.text.slice(0, Math.max(0, room - 1))}…` };
}

/** `thought for 12s`, dim, then the thinking text under it while Ctrl-O is on. */
export function thinkingLines(message: ChatMessage, width: number, expanded: boolean): Span[][] {
  const line = thinkingLine(message);
  if (line === null) {
    return [];
  }
  const lines = wrapSpans([{ text: line, dim: true }], width);
  if (!expanded || message.thinking === undefined) {
    return lines;
  }
  for (const row of message.thinking.replace(/\s+$/, "").split("\n")) {
    lines.push(...wrapSpans([{ text: `  │ ${visibleText(row)}`, dim: true }], width));
  }
  return lines;
}

export const SKILL_MARK = "◆ skill";

/** `/ship fix the mcp restart  ◆ skill`, then the filled-in body while Ctrl-O is on. */
export function skillLines(skill: SkillCall, body: string, width: number, expanded: boolean): Span[][] {
  const args = skill.args ?? "";
  const typed = args.length > 0 ? `/${skill.name} ${args}` : `/${skill.name}`;
  const lines = wrapSpans([{ text: visibleText(typed) }, { text: `  ${SKILL_MARK}`, dim: true }], width);
  if (!expanded) {
    return lines;
  }
  for (const row of body.replace(/\n+$/, "").split("\n")) {
    lines.push(...wrapSpans([{ text: `  │ ${visibleText(row)}`, dim: true }], width));
  }
  return lines;
}

/** The arguments in one line: string values first, joined by spaces. */
export function toolLabel(args: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      if (value.length > 0) {
        parts.push(value);
      }
    } else {
      rest[key] = value;
    }
  }
  const text = parts.length > 0 ? parts.join(" ") : Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";
  const line = text.replace(/\s+/g, " ");
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export function padLine(line: LayoutLine, width: number): LayoutLine {
  const used = line.spans.reduce((sum, span) => sum + span.text.length, 0);
  if (used >= width) {
    return line;
  }
  return { ...line, spans: [...line.spans, { text: " ".repeat(width - used) }] };
}

function labelSpans(label: string, message: ChatMessage, options: TranscriptOptions | undefined): Span[] {
  const spans: Span[] = [{ text: label, bold: true }];
  if (options?.times !== true || message.at === undefined) {
    return spans;
  }
  const stamp = formatMessageTime(message.at, options.now);
  if (stamp.length === 0) {
    return spans;
  }
  spans.push({ text: `  ${stamp}`, dim: true });
  return spans;
}

/** The footer of an answer: its time, then the model, tokens and cost of the run's calls. */
function answerDuration(message: ChatMessage, run: readonly ChatMessage[]): string | null {
  if (message.role !== "assistant" || message.streaming || message.durationMs === undefined) {
    return null;
  }
  const time = formatDuration(message.durationMs);
  const text = [time, ...turnFooterParts(turnTotals(run))].filter((part) => part.length > 0).join(" · ");
  return text.length > 0 ? text : null;
}

function paint(line: LayoutLine, width: number): LayoutLine {
  if (line.role !== "user") {
    return line;
  }
  return padLine(line, width);
}

export function markdownLines(source: string, width: number): Span[][] {
  const lines: Span[][] = [];
  for (const token of Lexer.lex(source)) {
    lines.push(...blockLines(token, width));
  }
  if (lines.length === 0) {
    return [[]];
  }
  return lines;
}

function blockLines(token: Token, width: number): Span[][] {
  if (token.type === "space") {
    return [[{ text: "" }]];
  }
  if (token.type === "code") {
    const code = token as Tokens.Code;
    return code.text
      .replace(/\n$/, "")
      .split("\n")
      .flatMap((line: string) => wrapSpans([{ text: line, code: true }], width));
  }
  if (token.type === "list") {
    return listLines(token as Tokens.List, width);
  }
  if (token.type === "heading" || token.type === "paragraph" || token.type === "blockquote") {
    const spans = inlineSpans(token.tokens);
    if (token.type === "heading") {
      return wrapSpans(
        spans.map((span) => ({ ...span, bold: true })),
        width,
      );
    }
    return wrapSpans(spans, width);
  }
  if ("text" in token && typeof token.text === "string") {
    return wrapSpans([{ text: token.text }], width);
  }
  return [];
}

function listLines(token: Tokens.List, width: number): Span[][] {
  const lines: Span[][] = [];
  for (const item of token.items) {
    const spans: Span[] = [{ text: "- " }];
    for (const child of item.tokens) {
      if (child.type === "text" || child.type === "paragraph") {
        spans.push(...inlineSpans(child.tokens));
      } else if (child.type === "code") {
        spans.push({ text: child.text, code: true });
      } else if ("text" in child && typeof child.text === "string") {
        spans.push({ text: child.text });
      }
    }
    lines.push(...wrapSpans(spans, width));
  }
  return lines;
}

function inlineSpans(tokens: Token[] | undefined): Span[] {
  if (tokens === undefined) {
    return [];
  }
  const spans: Span[] = [];
  for (const token of tokens) {
    if (token.type === "text" || token.type === "escape") {
      spans.push({ text: token.text });
    } else if (token.type === "strong") {
      for (const span of inlineSpans(token.tokens)) {
        spans.push({ ...span, bold: true });
      }
    } else if (token.type === "em") {
      for (const span of inlineSpans(token.tokens)) {
        spans.push({ ...span, italic: true });
      }
    } else if (token.type === "codespan") {
      spans.push({ text: token.text, code: true });
    } else if (token.type === "br") {
      spans.push({ text: "\n" });
    } else if ("text" in token && typeof token.text === "string") {
      spans.push({ text: token.text });
    }
  }
  return spans;
}

// The rows wrapSpans made by wrapping, and what each wrap took out. Kept apart, so a row is still a plain array.
const JOINTS = new WeakMap<readonly Span[], Joint>();

/** A row from wrapSpans as a line, marked when it only continues the row above. */
function wrappedLine(role: LineRole, spans: readonly Span[]): LayoutLine {
  const joins = JOINTS.get(spans);
  return joins === undefined ? { role, spans } : { role, spans, joins };
}

export function wrapSpans(spans: readonly Span[], width: number): Span[][] {
  const widthSafe = Math.max(1, width);
  const lines: Span[][] = [];
  let current: Span[] = [];
  let used = 0;

  function breakLine(joins?: Joint): void {
    lines.push(current);
    current = [];
    used = 0;
    if (joins !== undefined) {
      JOINTS.set(current, joins);
    }
  }

  for (const span of spans) {
    const parts = span.text.split("\n");
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      if (partIndex > 0) {
        breakLine();
      }
      let rest = parts[partIndex] ?? "";
      while (rest.length > 0) {
        const room = widthSafe - used;
        if (room <= 0) {
          breakLine("");
          continue;
        }
        if (rest.length <= room) {
          current.push({ ...span, text: rest });
          used += rest.length;
          rest = "";
          break;
        }
        const window = rest.slice(0, room);
        let take = window.lastIndexOf(" ");
        if (take <= 0) {
          take = room;
        }
        current.push({ ...span, text: rest.slice(0, take) });
        rest = rest.slice(take);
        let joins: Joint = "";
        if (rest.startsWith(" ")) {
          rest = rest.slice(1);
          joins = " ";
        }
        breakLine(joins);
      }
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  if (lines.length === 0) {
    lines.push([]);
  }
  return lines;
}
