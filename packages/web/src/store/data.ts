import { RpcError, type DataAddParams, type DataAddResult, type DataChanged, type DataColumn, type DataDescribeResult, type DataExportResult, type DataInspectParams, type DataInspectResult, type DataListResult, type DataNotesGetResult, type DataResult, type DataSavedQuery, type DataSource, type DataTable, type DataUpdateParams, type ToolTable } from "@golem/client";

export type { DataAddParams, DataAddResult, DataChanged, DataColumn, DataDescribeResult, DataExportResult, DataInspectParams, DataInspectResult, DataListResult, DataNotesGetResult, DataResult, DataSavedQuery, DataSource, DataTable, DataUpdateParams, ToolTable };

/** The query key of `data.list`. A pushed `data.changed` and every action below mark it stale. */
export const DATA_LIST_KEY = ["data.list"] as const;

/** The query key of `data.describe`. */
export const DATA_DESCRIBE_KEY = ["data.describe"] as const;

/** The query key of `data.notes.get`. */
export const DATA_NOTES_KEY = ["data.notes.get"] as const;

/** One source with its tables. `table` is set when one table's sample was asked for on its own. */
export function dataDescribeKey(name: string, table: string | null = null): readonly unknown[] {
  return table === null ? [...DATA_DESCRIBE_KEY, name] : [...DATA_DESCRIBE_KEY, name, table];
}

export function dataNotesKey(name: string): readonly unknown[] {
  return [...DATA_NOTES_KEY, name];
}

/**
 * What a data call gave back: the answer, or the news that the daemon does not know the method yet.
 * A missing method is a state to show, not an error to throw.
 */
export type DataAnswer<T> = { status: "ready"; data: T } | { status: "missing" };

const METHOD_NOT_FOUND = -32601;

/** The daemon has no such `data.*` method: it is older than the screen. */
export function isDataMissing(error: unknown): boolean {
  return error instanceof RpcError && error.code === METHOD_NOT_FOUND;
}

/** Runs a data call and turns a missing method into `{ status: "missing" }`. Any other failure is thrown. */
export async function dataAnswer<T>(call: () => Promise<T>): Promise<DataAnswer<T>> {
  try {
    return { status: "ready", data: await call() };
  } catch (error) {
    if (isDataMissing(error)) return { status: "missing" };
    throw error;
  }
}

/** One line for a data call the daemon refused or could not reach. */
export function dataErrorText(error: unknown, fallback: string): string {
  if (isDataMissing(error)) return "This version of golem cannot do that yet. Update golem.";
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

export type { DataExtensionName } from "@golem/view";

/** What a page of a kept result is asked by. */
export type DataResultPageParams = { result_id: string; offset: number; limit: number };

/** What a file is written by: the result, the new file's path, and its format. */
export type DataExportParams = { result_id: string; path: string; format: "csv" | "parquet" | "json" | "xlsx" };

/** The sample rows of one table. */
export type DataSampleRows = readonly (readonly (string | number | boolean | null)[])[];
