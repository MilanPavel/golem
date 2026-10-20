import { Lexer, type Token, type Tokens } from "marked";

import type { ChatMessage, ToolBlock } from "./chat-state.ts";
import { visibleText } from "./sanitize.ts";
import { formatDuration, formatMessageTime } from "./transcript.ts";

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  dim?: boolean;
};

export type LineRole = "user" | "assistant" | "plain";

export type LayoutLine = {
  role: LineRole;
  spans: readonly Span[];
};

export type Viewport = {
  lines: LayoutLine[];
  overflow: boolean;
  offsetFromBottom: number;
};

export type Transcript = Viewport & {
  gutter: readonly string[] | null;
  lineCount: number;
};

export type TranscriptOptions = {
  times: boolean;
  now: number;
  /** Ctrl-O: draw each tool call's output under its line. */
  toolOutput?: boolean;
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
  for (const message of messages) {
    const continues = previous?.role === "assistant" && message.role === "assistant";
    previous = message;
    if (lines.length > 0 && !continues) {
      lines.push({ role: "plain", spans: [{ text: "" }] });
    }
    const role: LineRole = message.role === "user" ? "user" : "assistant";
    const label = role === "user" ? "you" : "golem";
    const tools = message.tools ?? [];
    const body =
      tools.length > 0 && message.text.length === 0
        ? []
        : message.streaming
          ? wrapSpans([{ text: message.text }], width)
          : markdownLines(message.text, width);
    if (!continues) {
      lines.push(paint({ role, spans: labelSpans(label, message, options) }, width));
    }
    for (const spans of body) {
      lines.push(paint({ role, spans }, width));
    }
    for (const tool of tools) {
      for (const spans of toolLines(tool, width, options?.toolOutput === true)) {
        lines.push({ role, spans });
      }
    }
    const duration = tools.length > 0 ? null : answerDuration(message);
    if (duration !== null) {
      lines.push(paint({ role, spans: [{ text: duration, dim: true }] }, width));
    }
    if (message.interrupted === true) {
      lines.push(paint({ role, spans: [{ text: INTERRUPTED_MARK, italic: true }] }, width));
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
  const fitted = fitViewport(lines, rows, offsetFromBottom);
  const gutter =
    fitted.overflow && fitted.lines.length > 0
      ? gutterColumn(lines.length, fitted.lines.length, fitted.offsetFromBottom)
      : null;
  return { ...fitted, gutter, lineCount: lines.length };
}

/** `read_file src/a.ts ✓  12 lines`, then the output while Ctrl-O is on. */
export function toolLines(tool: ToolBlock, width: number, expanded: boolean): Span[][] {
  const head: Span[] = [{ text: tool.name, bold: true }];
  const label = toolLabel(tool.args);
  if (label.length > 0) {
    head.push({ text: ` ${label}` });
  }
  head.push({ text: ` ${TOOL_MARKS[tool.status]}`, dim: tool.status !== "failed" });
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
  return { role: line.role, spans: [...line.spans, { text: " ".repeat(width - used) }] };
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

function answerDuration(message: ChatMessage): string | null {
  if (message.role !== "assistant" || message.streaming || message.durationMs === undefined) {
    return null;
  }
  const text = formatDuration(message.durationMs);
  return text.length > 0 ? text : null;
}

function paint(line: LayoutLine, width: number): LayoutLine {
  if (line.role !== "user") {
    return line;
  }
  return padLine(line, width);
}

function markdownLines(source: string, width: number): Span[][] {
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

export function wrapSpans(spans: readonly Span[], width: number): Span[][] {
  const widthSafe = Math.max(1, width);
  const lines: Span[][] = [];
  let current: Span[] = [];
  let used = 0;

  function breakLine(): void {
    lines.push(current);
    current = [];
    used = 0;
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
          breakLine();
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
        if (rest.startsWith(" ")) {
          rest = rest.slice(1);
        }
        breakLine();
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
