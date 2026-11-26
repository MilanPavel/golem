/**
 * The words and the logic of a query result in a chat: how a cell reads, which way a column aligns,
 * how a page is sorted, which chart a result can be, and what a model that got only a stub saw.
 * Pure, so the web and the terminal say the same thing.
 */
import { countText } from "./data.ts";

export type ResultCell = string | number | boolean | null;

/** The part of a column the words need. */
export interface ResultColumn {
  name: string;
  type: string;
}

/** What the first page of a kept result says about itself. */
export interface ResultLike {
  result_id: string;
  source: string;
  columns: readonly ResultColumn[];
  total_rows: number;
  truncated?: boolean | undefined;
}

export const RESULT_PAGE_SIZES: readonly number[] = [50, 200, 1000];
export const RESULT_DEFAULT_PAGE_SIZE = 50;

/** The most bars of a bar chart and the most points of a line chart. */
export const CHART_BAR_MAX = 50;
export const CHART_POINT_MAX = 1000;

export const SORTED_ON_PAGE = "sorted on this page";
export const ROWS_WITHHELD_LINE = "The model saw only the row count and column names";

const NUMERIC_TYPE = /^(u?(tiny|small|big|huge)?int(eger)?\d*|float\d*|double|real|decimal|numeric|number|money)(?![a-z])/i;
const DATE_TYPE = /^(date|timestamp|datetime)/i;

export function isNumericType(type: string): boolean {
  return NUMERIC_TYPE.test(type.trim());
}

export function isDateType(type: string): boolean {
  return DATE_TYPE.test(type.trim());
}

/** Numbers line up on the right, everything else on the left. */
export function columnAlign(type: string): "left" | "right" {
  return isNumericType(type) ? "right" : "left";
}

export type CellKind = "null" | "number" | "boolean" | "text";

export interface CellView {
  text: string;
  kind: CellKind;
}

function numberText(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return countText(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 1 ? 2 : 6 }).replace(/,/g, "\u00a0");
}

/** How one cell reads: NULL as its own kind (a client dims it), numbers grouped in thousands, text as it is. */
export function formatCell(value: ResultCell): CellView {
  if (value === null) return { text: "NULL", kind: "null" };
  if (typeof value === "number") return { text: numberText(value), kind: "number" };
  if (typeof value === "boolean") return { text: value ? "true" : "false", kind: "boolean" };
  return { text: value, kind: "text" };
}

export const CELL_CUT = 80;

/** A long text cut to `max` characters with an ellipsis. `cut` says whether anything was left out. */
export function cutCell(text: string, max: number = CELL_CUT): { text: string; cut: boolean } {
  return text.length <= max ? { text, cut: false } : { text: `${text.slice(0, max - 1)}…`, cut: true };
}

function compare(a: ResultCell, b: ResultCell, numeric: boolean): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (numeric) {
    const x = Number(a);
    const y = Number(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** The rows of a page sorted on one column. NULL goes last either way; rows that tie keep their order. */
export function sortRows<T extends readonly ResultCell[]>(rows: readonly T[], column: number, type: string, descending: boolean): T[] {
  const numeric = isNumericType(type);
  return rows
    .map((row, at) => ({ row, at }))
    .sort((p, q) => {
      const a = p.row[column] ?? null;
      const b = q.row[column] ?? null;
      if (a === null || b === null) return a === b ? p.at - q.at : a === null ? 1 : -1;
      const order = compare(a, b, numeric);
      return order === 0 ? p.at - q.at : descending ? -order : order;
    })
    .map((entry) => entry.row);
}

function rowsText(n: number): string {
  return n === 1 ? "1 row" : `${countText(n)} rows`;
}

/** `1–50 of 18 302 rows`, or `9 rows` when the page is the whole result. */
export function rowRangeText(offset: number, shown: number, total: number): string {
  if (shown === 0) return rowsText(total);
  if (offset === 0 && shown >= total) return rowsText(total);
  return `${countText(offset + 1)}–${countText(offset + shown)} of ${rowsText(total)}`;
}

/** The offset of the next page, or null on the last one. */
export function nextOffset(offset: number, size: number, total: number): number | null {
  return offset + size < total ? offset + size : null;
}

/** The offset of the previous page, or null on the first one. */
export function previousOffset(offset: number, size: number): number | null {
  return offset <= 0 ? null : Math.max(0, offset - size);
}

export type ChartKind = "bar" | "line";

/** Which chart a result can be: the label column, the numeric columns, and bars or a line. */
export interface ChartPick {
  kind: ChartKind;
  label: number;
  values: number[];
}

/**
 * The chart a result's column types allow: one text or date column and one or more numeric ones. Bars for a
 * text column, a line for a date or time. A result of any other shape has no chart.
 */
export function pickChart(columns: readonly ResultColumn[]): ChartPick | null {
  const indexed = columns.map((column, at) => ({ column, at }));
  const labels = indexed.filter((entry) => !isNumericType(entry.column.type));
  const values = indexed.filter((entry) => isNumericType(entry.column.type));
  const [only] = labels;
  if (labels.length !== 1 || only === undefined || values.length === 0) return null;
  return { kind: isDateType(only.column.type) ? "line" : "bar", label: only.at, values: values.map((entry) => entry.at) };
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartData {
  points: ChartPoint[];
  /** How many rows the chart leaves out, when there are more than it draws. */
  cut: number;
}

/** The points of one value column. A row whose value is not a number is skipped. Bars stop at 50, a line at 1000. */
export function chartPoints(rows: readonly (readonly ResultCell[])[], pick: ChartPick, valueColumn: number): ChartData {
  const max = pick.kind === "bar" ? CHART_BAR_MAX : CHART_POINT_MAX;
  const all: ChartPoint[] = [];
  for (const row of rows) {
    const raw = row[valueColumn];
    const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
    if (Number.isNaN(value)) continue;
    all.push({ label: String(row[pick.label] ?? "NULL"), value });
  }
  return { points: all.slice(0, max), cut: Math.max(0, all.length - max) };
}

/** The line under a chart that was cut. */
export function chartCutNote(kind: ChartKind, cut: number): string {
  const drawn = kind === "bar" ? `the first ${CHART_BAR_MAX} bars` : `the first ${countText(CHART_POINT_MAX)} points`;
  return `Only ${drawn} are drawn. ${cut === 1 ? "1 more row is" : `${countText(cut)} more rows are`} in the table.`;
}

/** What the model got in place of the rows, as the tool block shows it. */
export function modelSawText(result: ResultLike): string {
  return `result ${result.result_id}: ${rowsText(result.total_rows)} × ${result.columns.length} cols, shown to the user.\nrows not sent: the privacy of @${result.source} keeps them off this model.\ncolumns: ${result.columns.map((column) => `${column.name} ${column.type}`).join(", ")}`;
}

/** The line above the table: its size and where it came from. */
export function resultHeader(result: ResultLike): string {
  return `table · ${rowsText(result.total_rows)} · from @${result.source}${result.truncated === true ? " · the query had more rows than were kept" : ""}`;
}

export type DataExtensionName = "excel" | "sqlite";

export const EXTENSION_BUTTON = "Get it (one-time download)";

const EXTENSION_WORD: Record<DataExtensionName, string> = { excel: "Excel", sqlite: "SQLite" };

/** What the add-on is for and where it goes, before anything downloads. */
export function extensionNote(name: DataExtensionName): string {
  return `Reading ${EXTENSION_WORD[name]} files needs a small add-on. golem downloads it once into its own folder, and only when you press the button.`;
}

export function extensionDownloading(name: DataExtensionName): string {
  return `Downloading the ${EXTENSION_WORD[name]} add-on…`;
}
