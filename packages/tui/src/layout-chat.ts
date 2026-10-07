import { Lexer, type Token, type Tokens } from "marked";

import type { ChatMessage } from "./chat-state.ts";

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

export type LayoutLine = readonly Span[];

const CHROME_ROWS = 2;

export function layoutChat(
  messages: readonly ChatMessage[],
  columns: number,
  rows: number,
): LayoutLine[] {
  const width = Math.max(1, columns);
  const bodyRows = Math.max(0, rows - CHROME_ROWS);
  const lines: LayoutLine[] = [];
  for (const message of messages) {
    if (lines.length > 0) {
      lines.push([{ text: "" }]);
    }
    lines.push([{ text: message.role === "user" ? "you" : "golem", bold: true }]);
    const body = message.streaming
      ? wrapSpans([{ text: message.text }], width)
      : markdownLines(message.text, width);
    lines.push(...body);
  }
  if (lines.length <= bodyRows) {
    return lines;
  }
  return lines.slice(lines.length - bodyRows);
}

function markdownLines(source: string, width: number): LayoutLine[] {
  const lines: LayoutLine[] = [];
  for (const token of Lexer.lex(source)) {
    lines.push(...blockLines(token, width));
  }
  if (lines.length === 0) {
    return [[]];
  }
  return lines;
}

function blockLines(token: Token, width: number): LayoutLine[] {
  if (token.type === "space") {
    return [[{ text: "" }]];
  }
  if (token.type === "code") {
    const code = token as Tokens.Code;
    return code.text
      .replace(/\n$/, "")
      .split("\n")
      .map((line: string) => [{ text: line, code: true }]);
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

function listLines(token: Tokens.List, width: number): LayoutLine[] {
  const lines: LayoutLine[] = [];
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

export function wrapSpans(spans: readonly Span[], width: number): LayoutLine[] {
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
