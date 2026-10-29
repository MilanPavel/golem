import type { LayoutLine, Span } from "./layout-chat.ts";

/**
 * Selecting text in the chat with the mouse. A point is a row of the whole
 * transcript at the width shown, not a screen row, so a selection stays put
 * while the chat scrolls. Columns count characters, as the layout does.
 */

export type Point = { line: number; column: number };

/** Where the press was, and where the pointer is now. Both cells are selected. */
export type Selection = { anchor: Point; head: Point };

/** Where the chat is on the screen, and which rows of the transcript it shows. */
export type ChatView = {
  /** The screen row of the chat's first row. */
  top: number;
  /** Chat rows on screen. */
  rows: number;
  /** The transcript row in the chat's first row. */
  first: number;
  /** Rows in the whole transcript. */
  count: number;
  /** Columns of text, without the scrollbar. */
  width: number;
};

/** The transcript row under a screen cell, or null outside the chat. */
export function pointAt(view: ChatView, row: number, column: number): Point | null {
  const index = row - view.top;
  if (index < 0 || index >= view.rows || column < 0 || column >= view.width) {
    return null;
  }
  const line = view.first + index;
  return line < view.count ? { line, column } : null;
}

/**
 * The point a drag reaches, held inside the chat. `scroll` is 1 above the
 * chat and -1 below it, so the chat moves a row toward the pointer.
 */
export function dragTo(view: ChatView, row: number, column: number): { point: Point; scroll: -1 | 0 | 1 } {
  const last = Math.max(0, Math.min(view.rows, view.count - view.first) - 1);
  const index = row - view.top;
  const above = index < 0 && view.first > 0;
  const below = index > last && view.first + view.rows < view.count;
  const scroll = above ? 1 : below ? -1 : 0;
  const shown = Math.max(0, Math.min(last, index));
  const line = Math.max(0, Math.min(view.count - 1, view.first + shown - scroll));
  return { point: { line, column: Math.max(0, Math.min(view.width - 1, column)) }, scroll };
}

/** The start and the end of `selection`, top first. */
export function ordered(selection: Selection): [Point, Point] {
  const { anchor, head } = selection;
  const first = anchor.line < head.line || (anchor.line === head.line && anchor.column <= head.column);
  return first ? [anchor, head] : [head, anchor];
}

/** True when the pointer never left the cell it was pressed on: a click, not a selection. */
export function isClick(selection: Selection): boolean {
  return selection.anchor.line === selection.head.line && selection.anchor.column === selection.head.column;
}

/** The selected columns of transcript row `line`, `[from, to)`, or null when none are. */
export function selectedColumns(selection: Selection, line: number): [number, number] | null {
  const [start, end] = ordered(selection);
  if (line < start.line || line > end.line) {
    return null;
  }
  const from = line === start.line ? start.column : 0;
  const to = line === end.line ? end.column + 1 : Number.POSITIVE_INFINITY;
  return [from, to];
}

export function lineText(line: LayoutLine): string {
  return line.spans.map((span) => span.text).join("");
}

/**
 * The selected text. Rows a wrap split are joined with what the wrap took out,
 * so a wrapped paragraph copies as one line. Each row loses its trailing
 * spaces, such as the padding of your own messages.
 */
export function selectedText(lines: readonly LayoutLine[], selection: Selection): string {
  const [start, end] = ordered(selection);
  let text = "";
  for (let index = start.line; index <= end.line && index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const columns = selectedColumns(selection, index);
    const piece = columns === null ? "" : lineText(line).slice(columns[0], columns[1]).trimEnd();
    if (index > start.line) {
      text += line.joins ?? "\n";
    }
    text += piece;
  }
  return text;
}

/** `spans` cut at the selected columns, each part marked. */
export function markSpans(spans: readonly Span[], columns: [number, number] | null): { span: Span; selected: boolean }[] {
  if (columns === null) {
    return spans.map((span) => ({ span, selected: false }));
  }
  const [from, to] = columns;
  const parts: { span: Span; selected: boolean }[] = [];
  let at = 0;
  for (const span of spans) {
    const start = at;
    const end = at + span.text.length;
    at = end;
    const cuts = [start, Math.max(start, Math.min(end, from)), Math.max(start, Math.min(end, to)), end];
    for (let index = 0; index < 3; index += 1) {
      const a = cuts[index] ?? start;
      const b = cuts[index + 1] ?? end;
      if (b > a) {
        parts.push({ span: { ...span, text: span.text.slice(a - start, b - start) }, selected: index === 1 });
      }
    }
  }
  return parts;
}
