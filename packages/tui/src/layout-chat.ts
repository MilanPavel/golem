import { Lexer, type Token, type Tokens } from "marked";

import type { ChatMessage } from "./chat-state.ts";

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
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
};

export function layoutMessages(messages: readonly ChatMessage[], columns: number): LayoutLine[] {
  const width = Math.max(1, columns);
  const lines: LayoutLine[] = [];
  for (const message of messages) {
    if (lines.length > 0) {
      lines.push({ role: "plain", spans: [{ text: "" }] });
    }
    const role: LineRole = message.role === "user" ? "user" : "assistant";
    const label = role === "user" ? "you" : "golem";
    const body = message.streaming
      ? wrapSpans([{ text: message.text }], width)
      : markdownLines(message.text, width);
    lines.push(paint({ role, spans: [{ text: label, bold: true }] }, width));
    for (const spans of body) {
      lines.push(paint({ role, spans }, width));
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
): Transcript {
  const width = Math.max(1, columns);
  const full = layoutMessages(messages, width);
  const rows = Math.max(0, bodyRows);
  const overflows = rows > 0 && full.length > rows;
  const contentWidth = overflows ? Math.max(1, width - 1) : width;
  const lines = overflows ? layoutMessages(messages, contentWidth) : full;
  const fitted = fitViewport(lines, rows, offsetFromBottom);
  const gutter =
    fitted.overflow && fitted.lines.length > 0
      ? gutterColumn(lines.length, fitted.lines.length, fitted.offsetFromBottom)
      : null;
  return { ...fitted, gutter };
}

export function padLine(line: LayoutLine, width: number): LayoutLine {
  const used = line.spans.reduce((sum, span) => sum + span.text.length, 0);
  if (used >= width) {
    return line;
  }
  return { role: line.role, spans: [...line.spans, { text: " ".repeat(width - used) }] };
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
