/**
 * The words of the Data screens: the privacy levels, the chips, the rows of the source list and the steps of
 * the add dialog. Pure, so the web and the terminal say the same thing.
 */

export type DataPrivacy = "open" | "local" | "schema";
export type DataScope = "builtin" | "user" | "project";
export type DataKind = "builtin" | "files" | "sqlite" | "duckdb" | "postgres" | "mysql" | "url";
export type DataStatus = "ready" | "reading" | "untrusted" | "error";

/** The part of a source the words need. */
export interface DataSourceLike {
  name: string;
  kind: DataKind;
  scope: DataScope;
  project?: string | null | undefined;
  privacy: DataPrivacy;
  status: DataStatus;
  error?: string | null | undefined;
  tables?: number | null | undefined;
  rows?: number | null | undefined;
}

export const DATA_PRIVACIES: readonly DataPrivacy[] = ["open", "local", "schema"];

/** The chip of a privacy level. */
export const PRIVACY_CHIP: Record<DataPrivacy, string> = {
  open: "rows open",
  local: "rows local",
  schema: "schema only",
};

/** What a privacy level means, as a sentence for the settings. */
export const PRIVACY_SENTENCE: Record<DataPrivacy, string> = {
  open: "Every model may read rows and results.",
  local: 'Local models read rows. Hosted models see the schema, row counts and column stats, and a result reaches them as "N rows, shown to the user".',
  schema: "No model sees rows. The model writes queries, and only you see what they return.",
};

/** The same levels, short, for the add dialog. */
export const PRIVACY_SHORT: Record<DataPrivacy, string> = {
  open: "every model, local or hosted",
  local: "local models only. Hosted models get the schema and counts",
  schema: "no model. Only you see rows",
};

/** Why the built-in source has no privacy choice. */
export const BUILTIN_PRIVACY_NOTE = "golem's own usage, runs and chats list. No message text.";

/** The caption above the sample rows: who sees them. */
export function sampleCaption(privacy: DataPrivacy): string {
  if (privacy === "local") return "you and local models";
  if (privacy === "schema") return "only you, on request";
  return "you and every model";
}

export const SAMPLE_SCHEMA_NOTE = "Schema only: golem fetches no rows for this source until you ask. Only you see them.";

/** The caption above the columns of a table. */
export const COLUMNS_CAPTION = "Columns · every model may see these";

/** What a screen says while the daemon does not know the data methods. */
export const DATA_NOT_AVAILABLE = "Data sources are not available yet in this version of golem. Update golem to use them.";

/** The notes tab, while the notes methods are missing. */
export const NOTES_NOT_AVAILABLE = "Notes come in a later version of golem.";

export const QUERIES_EMPTY = "Save a query from a chat result and it shows here.";

export const REMOVE_SENTENCE = "golem forgets it. The files and the database stay as they are.";

export const PASSWORD_NOTE = "goes to the macOS Keychain, never to a file or a model";

/** `18302` as `18 302`, with no-break spaces. */
export function countText(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function tablesText(n: number): string {
  return n === 1 ? "1 table" : `${n} tables`;
}

/** The one-line detail of a source row: its size, or why it cannot be used yet. */
export function sourceDetail(source: DataSourceLike): string {
  if (source.status === "reading") return "reading…";
  if (source.status === "untrusted") return "untrusted — trust this folder to use it";
  if (source.status === "error") return source.error === null || source.error === undefined || source.error === "" ? "could not be read" : source.error;
  const parts: string[] = [];
  if (source.tables !== null && source.tables !== undefined) parts.push(tablesText(source.tables));
  if (source.rows !== null && source.rows !== undefined) parts.push(`${countText(source.rows)} rows`);
  return parts.join(" · ");
}

/** The word for a source's kind, in the top bar and the list. */
export function kindWord(kind: DataKind): string {
  if (kind === "builtin") return "built in";
  if (kind === "files") return "files";
  if (kind === "sqlite") return "SQLite";
  if (kind === "duckdb") return "DuckDB";
  if (kind === "postgres") return "PostgreSQL";
  if (kind === "mysql") return "MySQL";
  return "URL";
}

/** A short glyph for a kind, for the list. */
export function kindGlyph(kind: DataKind): string {
  if (kind === "builtin") return "◆";
  if (kind === "files") return "▤";
  if (kind === "url") return "⌁";
  return "db";
}

export interface DataGroups<T> {
  /** The sources of the folder in view. Null when no folder is. */
  project: T[] | null;
  /** The person's own sources and the built-in one. */
  yours: T[];
}

/** The list's two groups: the project of `folder`, and yours. A project source of another folder is left out. */
export function groupSources<T extends DataSourceLike>(sources: readonly T[], folder: string | null): DataGroups<T> {
  const project = folder === null ? null : sources.filter((source) => source.scope === "project" && source.project === folder);
  return { project, yours: sources.filter((source) => source.scope !== "project") };
}

/** Where a source is saved, in words. */
export function savedInText(scope: DataScope): string {
  if (scope === "project") return "this project, in .golem/config.toml";
  if (scope === "user") return "your config, ~/.golem/config.toml, for every chat";
  return "built in";
}

/** The text a new chat starts with to ask about a source. */
export function askText(name: string): string {
  return `@${name} `;
}

/** What the composer holds to run a saved query. */
export function runQueryText(source: string, sql: string): string {
  return `Run this on @${source}:\n\n${sql}`;
}

/** The steps of the add dialog, in order. */
export const ADD_STEPS = ["kind", "where", "privacy"] as const;
export type AddStep = (typeof ADD_STEPS)[number];

/** A step's name for the stepper, `1 · kind`. */
export function stepName(step: AddStep): string {
  return `${ADD_STEPS.indexOf(step) + 1} · ${step}`;
}

export type AddKind = "files" | "database" | "url" | "mcp";

export interface AddKindOption {
  kind: AddKind;
  title: string;
  detail: string;
}

/** The four ways to add, in order. */
export const ADD_KINDS: readonly AddKindOption[] = [
  { kind: "files", title: "Files or a folder", detail: "CSV, Parquet, JSON lines, Excel, SQLite. A glob reads many files as one table." },
  { kind: "database", title: "Database", detail: "Postgres, MySQL. Read-only, password in the Keychain." },
  { kind: "url", title: "A URL", detail: "A CSV or Parquet file on the web. The download asks per host." },
  { kind: "mcp", title: "Through MCP", detail: "BigQuery, Snowflake, Notion… adds an MCP server. No privacy split." },
];

export const FILES_PATH_EXAMPLE = "~/Documents/bank/*.csv";

/** The stats of a column in one line: its range, how many values differ, how many are empty. Empty when none is known. */
export function columnStats(column: { min?: string | null | undefined; max?: string | null | undefined; distinct?: number | null | undefined; null_fraction?: number | null | undefined }): string {
  const parts: string[] = [];
  if (column.min !== null && column.min !== undefined && column.max !== null && column.max !== undefined) parts.push(`${column.min} … ${column.max}`);
  if (column.distinct !== null && column.distinct !== undefined) parts.push(`${countText(column.distinct)} distinct`);
  if (column.null_fraction !== null && column.null_fraction !== undefined && column.null_fraction > 0) parts.push(`${Math.round(column.null_fraction * 100)}% empty`);
  return parts.join(" · ");
}

/** What a check of a location found. */
export function inspectSummary(found: { files?: number | null | undefined; tables: readonly { name: string }[] }): string {
  const names = found.tables.map((table) => table.name);
  const tables = names.length === 0 ? "no tables" : names.length === 1 ? `one table: ${names[0] ?? ""}` : `${names.length} tables: ${names.join(", ")}`;
  if (found.files === null || found.files === undefined) return `Found ${tables}.`;
  return `${found.files === 1 ? "1 file matches" : `${countText(found.files)} files match`}, ${tables}.`;
}
