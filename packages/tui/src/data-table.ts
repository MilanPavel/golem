import { countText, visibleText, type ChatMessage, type ToolBlock, type ToolTable } from "@golem/view";

import type { Span } from "./layout-chat.ts";

/**
 * The rows of a data result as aligned text for the terminal: columns fitted to the width, long text cut
 * with `…`, numbers to the right, NULL dim. Pure, so the transcript and `/data` draw the same table.
 */
export type Cell = string | number | boolean | null;

export type TableColumn = { name: string; type?: string | undefined };

/** Rows a finished result shows while it is closed. */
export const COLLAPSED_ROWS = 20;
/** Rows of one page while it is open. */
export const PAGE_ROWS = 20;

const GAP = 2;
const INDENT = 2;
/** The least a column is cut to, so a name stays readable. */
const MIN_WIDTH = 4;
/** The widest a column is before the width of the terminal is looked at. */
const MAX_NATURAL = 40;
const NUMERIC_TYPE = /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?\d*|DECIMAL|NUMERIC|DOUBLE|FLOAT\d*|REAL|NUMBER|MONEY)\b/i;

/** The text of a cell on one line, with control characters made visible. */
export function cellText(cell: Cell): string {
  if (cell === null) return "NULL";
  return visibleText(String(cell)).replace(/[\r\n\t]+/g, " ");
}

function length(text: string): number {
  return [...text].length;
}

function cut(text: string, width: number): string {
  const letters = [...text];
  if (letters.length <= width) return text;
  return width <= 1 ? "…".slice(0, width) : `${letters.slice(0, width - 1).join("")}…`;
}

/** Whether a column is numbers: its type says so, or every filled cell is a number. */
function isNumeric(column: TableColumn, rows: readonly (readonly Cell[])[], index: number): boolean {
  if (column.type !== undefined && NUMERIC_TYPE.test(column.type)) return true;
  const filled = rows.map((row) => row[index] ?? null).filter((cell) => cell !== null);
  return filled.length > 0 && filled.every((cell) => typeof cell === "number");
}

/** The width of each column so the row fits `room`. The widest columns give way first. */
function fitWidths(natural: readonly number[], room: number): number[] {
  const widths = natural.map((width) => Math.min(width, MAX_NATURAL));
  const total = (): number => widths.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, widths.length - 1);
  while (total() > room) {
    let widest = 0;
    for (const [index, width] of widths.entries()) {
      if (width > (widths[widest] ?? 0)) widest = index;
    }
    if ((widths[widest] ?? 0) <= MIN_WIDTH) break;
    widths[widest] = (widths[widest] ?? 0) - 1;
  }
  return widths;
}

export type TableLayout = {
  /** The header, its rule and the rows, each as spans indented two columns. */
  lines: Span[][];
  /** Columns left out because even cut short they did not fit. */
  hidden: number;
};

/** The table cut to `width` columns, with the header and a rule under it. */
export function tableLines(columns: readonly TableColumn[], rows: readonly (readonly Cell[])[], width: number): TableLayout {
  const room = Math.max(1, width - INDENT);
  const natural = columns.map((column, index) => Math.max(length(column.name), ...rows.map((row) => length(cellText(row[index] ?? null)))));
  let count = columns.length;
  while (count > 1 && natural.slice(0, count).reduce((sum, w) => sum + Math.min(w, MIN_WIDTH), 0) + GAP * (count - 1) > room) {
    count -= 1;
  }
  const shown = columns.slice(0, count);
  const widths = fitWidths(natural.slice(0, count), room);
  const right = shown.map((column, index) => isNumeric(column, rows, index));
  const align = (text: string, index: number, last: boolean): string => {
    const fitted = cut(text, widths[index] ?? 0);
    if (right[index] === true) return " ".repeat(Math.max(0, (widths[index] ?? 0) - length(fitted))) + fitted;
    return last ? fitted : fitted + " ".repeat(Math.max(0, (widths[index] ?? 0) - length(fitted)));
  };
  const spansOf = (cells: readonly string[], nulls: readonly boolean[], bold: boolean): Span[] => {
    const spans: Span[] = [{ text: " ".repeat(INDENT) }];
    for (const [index, text] of cells.entries()) {
      const last = index === cells.length - 1;
      const gap = index === 0 ? "" : " ".repeat(GAP);
      spans.push({ text: `${gap}${align(text, index, last)}`, ...(bold ? { bold: true } : {}), ...(nulls[index] === true ? { dim: true } : {}) });
    }
    return spans;
  };
  const lines: Span[][] = [spansOf(shown.map((column) => column.name), [], true)];
  lines.push([{ text: `${" ".repeat(INDENT)}${widths.map((w) => "─".repeat(w)).join(" ".repeat(GAP))}`, dim: true }]);
  for (const row of rows) {
    const cells = shown.map((_, index) => row[index] ?? null);
    lines.push(spansOf(cells.map(cellText), cells.map((cell) => cell === null), false));
  }
  return { lines, hidden: columns.length - count };
}

/** `0.12 s` */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

function rowsWord(count: number): string {
  return count === 1 ? "1 row" : `${countText(count)} rows`;
}

/** What a page of a result holds: the first row it starts at, and its rows. */
export type DataPage = { offset: number; rows: readonly (readonly Cell[])[] };

/** `N of M rows · source · 0.12 s`, with the range of rows for a later page. */
export function resultFooter(table: ToolTable, offset: number, shown: number, durationMs: number | undefined): string {
  const total = table.total_rows;
  const count =
    offset === 0
      ? `${countText(shown)} of ${rowsWord(total)}`
      : `${countText(offset + 1)}–${countText(offset + shown)} of ${rowsWord(total)}`;
  const parts = [count, table.source];
  if (durationMs !== undefined) parts.push(seconds(durationMs));
  if (table.truncated === true) parts.push("more rows than golem kept");
  return parts.join(" · ");
}

/** The line under a result whose rows the model did not get. */
export const WITHHELD_LINE = "the model saw only the row count and column names";

/**
 * The result block under a `data_query` line. Closed, the first rows, at most 20. Open, one page of 20,
 * with the page the person moved to when there is one.
 */
export function resultLines(tool: ToolBlock & { table: ToolTable }, width: number, expanded: boolean, page: DataPage | undefined): Span[][] {
  const table = tool.table;
  const offset = expanded && page !== undefined ? page.offset : 0;
  const source = expanded && page !== undefined ? page.rows : table.rows;
  const limit = expanded ? PAGE_ROWS : COLLAPSED_ROWS;
  const rows = source.slice(0, limit);
  const lines: Span[][] = [];
  if (table.columns.length > 0) {
    const laid = tableLines(table.columns, rows, width - 1);
    lines.push(...laid.lines);
    if (laid.hidden > 0) {
      lines.push([{ text: `  … ${laid.hidden} more ${laid.hidden === 1 ? "column" : "columns"}`, dim: true }]);
    }
  }
  const footer = resultFooter(table, offset, rows.length, tool.durationMs);
  const more = table.total_rows - offset - rows.length;
  const hint = !expanded ? (more > 0 ? " · ctrl+o to page" : "") : table.total_rows > PAGE_ROWS ? " · PgUp/PgDn" : "";
  lines.push([{ text: cut(`  ${footer}${hint}`, width - 1), dim: true }]);
  if (tool.rowsWithheld === true) {
    lines.push([{ text: cut(`  ${WITHHELD_LINE}`, width - 1), dim: true }]);
  }
  return lines;
}

/** Whether a call finished with a kept result. */
export function hasTable(tool: ToolBlock): tool is ToolBlock & { table: ToolTable } {
  return tool.status === "done" && tool.table !== undefined;
}

/** The newest result with more rows than one page holds, which PgUp and PgDn move through. */
export function pageableResult(messages: readonly ChatMessage[]): { callId: string; table: ToolTable } | null {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const tools = messages[at]?.tools ?? [];
    for (let index = tools.length - 1; index >= 0; index -= 1) {
      const tool = tools[index];
      if (tool !== undefined && hasTable(tool) && tool.table.total_rows > PAGE_ROWS) {
        return { callId: tool.callId, table: tool.table };
      }
    }
  }
  return null;
}

/** Where a key moves the page to, or null when it stays where it is. */
export function pageOffset(table: ToolTable, current: number, toward: "up" | "down"): number | null {
  const next = toward === "down" ? current + PAGE_ROWS : Math.max(0, current - PAGE_ROWS);
  if (toward === "down" && next >= table.total_rows) return null;
  return next === current ? null : next;
}
