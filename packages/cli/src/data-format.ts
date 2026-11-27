import type { DataColumn, DataDescribeResult, DataListResult } from "@golem/client";
import { countText, kindWord, PRIVACY_CHIP, withoutSingleFile } from "@golem/view";

type Source = DataListResult["sources"][number];
export type Cell = string | number | boolean | null;

/** The result of a query, as far as the formatting needs it. */
export interface QueryOutput {
  columns: readonly { name: string }[];
  rows: readonly (readonly Cell[])[];
  total_rows?: number | null;
  truncated?: boolean;
  elapsed_ms: number;
}

function pad(cells: readonly string[], widths: readonly number[], right: readonly boolean[]): string {
  return cells
    .map((cell, index) => (right[index] === true ? cell.padStart(widths[index] ?? 0) : cell.padEnd(widths[index] ?? 0)))
    .join("  ")
    .trimEnd();
}

function widthsOf(rows: readonly (readonly string[])[]): number[] {
  return rows.reduce<number[]>((max, row) => row.map((cell, index) => Math.max(max[index] ?? 0, [...cell].length)), []);
}

/** Aligned columns with two spaces between them, and no trailing spaces. */
function table(rows: readonly (readonly string[])[]): string {
  const widths = widthsOf(rows);
  return rows.map((row) => pad(row, widths, [])).join("\n");
}

function show(cell: Cell): string {
  if (cell === null) return "NULL";
  return String(cell).replace(/\r?\n/g, " ");
}

/** A header, a rule, and the rows. Numbers sit to the right. */
export function formatRows(columns: readonly { name: string }[], rows: readonly (readonly Cell[])[]): string {
  const cells = rows.map((row) => columns.map((_, index) => show(row[index] ?? null)));
  const header = columns.map((column) => column.name);
  const widths = widthsOf([header, ...cells]);
  const right = columns.map((_, index) => rows.length > 0 && rows.every((row) => row[index] === null || typeof row[index] === "number"));
  const rule = widths.map((width) => "─".repeat(width));
  return [pad(header, widths, right), pad(rule, widths, []), ...cells.map((row) => pad(row, widths, right))].join("\n");
}

/** One line per source. */
export function formatDataList(sources: readonly Source[]): string {
  if (sources.length === 0) return "no data sources";
  const rows = [["NAME", "KIND", "SCOPE", "TABLES", "ROWS", "PRIVACY", "STATUS"]];
  for (const source of sources) {
    const status = source.status === "error" && source.error ? `error: ${source.error}` : source.status;
    rows.push([
      source.name,
      kindWord(source.kind),
      source.scope,
      source.tables === null || source.tables === undefined ? "-" : String(source.tables),
      source.rows === null || source.rows === undefined ? "-" : countText(source.rows),
      PRIVACY_CHIP[source.privacy],
      status,
    ]);
  }
  return table(rows);
}

function stats(column: DataColumn): string {
  const parts: string[] = [];
  if (column.min !== null && column.min !== undefined && column.max !== null && column.max !== undefined) parts.push(`${column.min} to ${column.max}`);
  if (column.distinct !== null && column.distinct !== undefined) parts.push(`${column.distinct_estimate === true ? "~" : ""}${countText(column.distinct)} distinct`);
  if (column.null_fraction !== null && column.null_fraction !== undefined) parts.push(`${Math.round(column.null_fraction * 100)}% empty`);
  return parts.join(" · ");
}

/** The source, its tables with columns and stats, the notes, and the sample rows. */
export function formatDataDescribe(result: DataDescribeResult): string {
  const { source } = result;
  const detail = [kindWord(source.kind), source.scope, PRIVACY_CHIP[source.privacy]];
  if (source.tables !== null && source.tables !== undefined) detail.push(source.tables === 1 ? "1 table" : `${source.tables} tables`);
  if (source.rows !== null && source.rows !== undefined) detail.push(`${countText(source.rows)} rows`);
  const lines = [`${source.name}  ${detail.join(" · ")}`, `  ${source.location}`];
  if (source.status !== "ready") lines.push(`  ${source.status}${source.error ? `: ${source.error}` : ""}`);
  if (source.privacy_reason) lines.push(`  ${source.privacy_reason}`);
  for (const each of result.tables) {
    lines.push("", `${each.name}${each.rows === null || each.rows === undefined ? "" : `  ${countText(each.rows)} rows`}`);
    const shown = withoutSingleFile(each.columns ?? [], result.sample[each.name] ?? []);
    const columns = shown.columns.map((column) => [column.name, column.type, stats(column)]);
    if (columns.length > 0) lines.push(...table(columns).split("\n").map((line) => `  ${line}`));
    const sample = result.sample[each.name];
    if (sample !== undefined && sample.length > 0) {
      lines.push("", `  sample, ${sample.length === 1 ? "1 row" : `${sample.length} rows`}`);
      lines.push(...formatRows(shown.columns, shown.rows as Cell[][]).split("\n").map((line) => `  ${line}`));
    }
  }
  const notes = result.notes?.trim();
  if (notes) lines.push("", "notes", ...notes.split("\n").map((line) => `  ${line}`));
  if ((result.queries ?? []).length > 0) lines.push("", "saved queries", ...(result.queries ?? []).map((query) => `  ${query.name}`));
  return lines.join("\n");
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

function rowsWord(count: number): string {
  return count === 1 ? "1 row" : `${countText(count)} rows`;
}

/** "N rows · 0.12 s", or "first N of M rows · 0.12 s" when the result was cut. */
export function queryFooter(result: QueryOutput): string {
  const shown = result.rows.length;
  const total = result.total_rows;
  const count =
    result.truncated === true
      ? total === null || total === undefined
        ? `first ${rowsWord(shown)}`
        : `first ${countText(shown)} of ${rowsWord(total)}`
      : rowsWord(shown);
  return `${count} · ${seconds(result.elapsed_ms)}`;
}

/** The note for a cut result when the rows go to a script, so it goes to stderr. */
export function truncatedNote(result: QueryOutput): string | null {
  if (result.truncated !== true) return null;
  const total = result.total_rows;
  return total === null || total === undefined
    ? `first ${rowsWord(result.rows.length)} only`
    : `first ${countText(result.rows.length)} of ${rowsWord(total)}`;
}

function csvCell(cell: Cell): string {
  if (cell === null) return "";
  const text = String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The result as CSV with a header row. */
export function formatQueryCsv(result: QueryOutput): string {
  const lines = [result.columns.map((column) => csvCell(column.name)).join(",")];
  for (const row of result.rows) lines.push(result.columns.map((_, index) => csvCell(row[index] ?? null)).join(","));
  return lines.join("\n");
}

/** The rows as a JSON array of objects, one key per column. */
export function formatQueryJson(result: QueryOutput): string {
  const rows = result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column.name, row[index] ?? null])));
  return JSON.stringify(rows, null, 2);
}

/** The table, an empty line, and the footer. */
export function formatQueryTable(result: QueryOutput): string {
  const body = result.columns.length === 0 ? "" : `${formatRows(result.columns, result.rows)}\n`;
  return `${body}\n${queryFooter(result)}`;
}
