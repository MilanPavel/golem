/** Writing a kept result to a new file: the formats, the name a dialog starts with, and its lines. */

import { countText } from "./data.ts";

export type ExportFormat = "csv" | "parquet" | "json" | "xlsx";

export interface ExportFormatChoice {
  readonly value: ExportFormat;
  readonly label: string;
  readonly extension: string;
}

export const EXPORT_FORMATS: readonly ExportFormatChoice[] = [
  { value: "csv", label: "CSV", extension: "csv" },
  { value: "parquet", label: "Parquet", extension: "parquet" },
  { value: "json", label: "JSON", extension: "json" },
  { value: "xlsx", label: "Excel", extension: "xlsx" },
];

export const EXPORT_FOLDER = "~/Downloads";

/** Wider than the `.xlsx` of the list: the endings a path may already have. */
const ENDINGS: Record<string, ExportFormat> = { csv: "csv", parquet: "parquet", json: "json", jsonl: "json", ndjson: "json", xlsx: "xlsx" };

function extensionOf(format: ExportFormat): string {
  return EXPORT_FORMATS.find((choice) => choice.value === format)?.extension ?? format;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** `~/Downloads/bank-2026-11-26.csv`: the source, today's date in local time, and the ending of the format. */
export function defaultExportPath(source: string, today: Date, format: ExportFormat): string {
  const day = `${today.getFullYear()}-${twoDigits(today.getMonth() + 1)}-${twoDigits(today.getDate())}`;
  return `${EXPORT_FOLDER}/${source === "" ? "result" : source}-${day}.${extensionOf(format)}`;
}

/** The format a file name asks for, or null when its ending is none of ours. */
export function formatOfPath(path: string): ExportFormat | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(path.trim());
  return match === null ? null : (ENDINGS[(match[1] ?? "").toLowerCase()] ?? null);
}

/** `path` with the ending of `format`. A name with another ending of ours is changed, any other gets it added. */
export function withFormat(path: string, format: ExportFormat): string {
  const text = path.trim();
  if (text === "") return text;
  if (formatOfPath(text) === format) return text;
  const stem = formatOfPath(text) === null ? text : text.replace(/\.[A-Za-z0-9]+$/, "");
  return `${stem}.${extensionOf(format)}`;
}

export const EXPORT_TITLE = "Export the result";
export const EXPORT_BUTTON = "Export";
export const EXPORT_NEW_FILE_NOTE = "golem writes a new file. It never replaces one that is there, and never writes into a data source.";
export const EXPORT_EXCEL_NOTE = "Writing an Excel file needs a small add-on. golem downloads it once into its own folder, and only when you press the button.";

/** The line under the dialog after the file was written. */
export function exportedText(rows: number, path: string): string {
  return `Wrote ${rowsText(rows)} to ${path}.`;
}

function rowsText(rows: number): string {
  return rows === 1 ? "1 row" : `${countText(rows)} rows`;
}

/** The line under the dialog title when the query had more rows than were kept: how many go into the file, out of how many. */
export function exportCutText(kept: number, all: number | null): string {
  const of = all === null ? "" : ` of ${rowsText(all)}`;
  return `${rowsText(kept)}${of} will be exported: the query had more rows than were kept.`;
}

/** The title of the dialog. */
export function exportHeading(rows: number, source: string): string {
  return `${rowsText(rows)} from @${source}`;
}
