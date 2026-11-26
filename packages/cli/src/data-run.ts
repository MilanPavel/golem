import { randomUUID } from "node:crypto";

import { RpcError, type DataDescribeResult, type DataListResult, type DataResult, type GolemClient } from "@golem/client";

import type { DataArgs } from "./data-command.ts";
import {
  formatDataDescribe,
  formatDataList,
  formatQueryCsv,
  formatQueryJson,
  formatQueryTable,
  truncatedNote,
} from "./data-format.ts";

const METHOD_NOT_FOUND = -32601;

/** What the data commands need from the process, so a test can stand in. */
export interface DataDeps {
  write: (text: string) => void;
  error: (line: string) => void;
  /** True when stdin is a terminal, so there is no piped SQL. */
  stdinIsTty: boolean;
  readStdin: () => Promise<string>;
  /** Run `handler` on Ctrl-C. Returns the function that stops listening. */
  onInterrupt: (handler: () => void) => () => void;
  /** A new id for a query, so it can be cancelled by it. */
  newId?: () => string;
}

export const NO_DATA_METHODS = "This golem daemon does not know data sources yet. Update golem.";

/** Turn the daemon's "no such method" into a sentence. Anything else goes on. */
async function guarded<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof RpcError && error.code === METHOD_NOT_FOUND) throw new Error(NO_DATA_METHODS);
    throw error;
  }
}

type Client = Pick<GolemClient, "listData" | "describeData" | "queryData" | "cancelData">;

/** `golem data list`. */
export async function runDataList(client: Client, json: boolean, deps: DataDeps): Promise<number> {
  const result: DataListResult = await guarded(() => client.listData());
  deps.write(`${json ? JSON.stringify(result, null, 2) : formatDataList(result.sources)}\n`);
  return 0;
}

/** `golem data describe`. */
export async function runDataDescribe(client: Client, source: string, table: string | null, json: boolean, deps: DataDeps): Promise<number> {
  const result: DataDescribeResult = await guarded(() => client.describeData(source, table ?? undefined));
  deps.write(`${json ? JSON.stringify(result, null, 2) : formatDataDescribe(result)}\n`);
  return 0;
}

const INTERRUPTED = Symbol("interrupted");

/** `golem data query`. Ctrl-C cancels the query on the daemon and exits 130. */
export async function runDataQuery(client: Client, args: Extract<DataArgs, { kind: "query" }>, deps: DataDeps): Promise<number> {
  let sql = args.sql;
  if (sql === null) {
    if (deps.stdinIsTty) {
      deps.error("Give the SQL as a word after the source, or pipe it in on stdin.");
      return 1;
    }
    sql = (await deps.readStdin()).trim();
    if (sql.length === 0) {
      deps.error("The SQL on stdin is empty.");
      return 1;
    }
  }
  const resultId = (deps.newId ?? (() => `cli-${randomUUID()}`))();
  let interrupt: () => void = () => undefined;
  const interrupted = new Promise<typeof INTERRUPTED>((resolve) => {
    interrupt = () => resolve(INTERRUPTED);
  });
  const unhook = deps.onInterrupt(() => interrupt());
  try {
    const params = { source: args.source, sql, result_id: resultId, ...(args.limit === null ? {} : { limit: args.limit }) };
    const running = guarded(() => client.queryData(params));
    // The query may fail after Ctrl-C has won the race. That error is not news.
    running.catch(() => undefined);
    const outcome = await Promise.race([running, interrupted]);
    if (outcome === INTERRUPTED) {
      await client.cancelData(resultId).catch(() => undefined);
      deps.error("Cancelled.");
      return 130;
    }
    printQuery(outcome, args.format, deps);
    return 0;
  } finally {
    unhook();
  }
}

function printQuery(result: DataResult, format: "table" | "csv" | "json", deps: DataDeps): void {
  if (format === "table") {
    deps.write(`${formatQueryTable(result)}\n`);
    return;
  }
  deps.write(`${format === "csv" ? formatQueryCsv(result) : formatQueryJson(result)}\n`);
  const note = truncatedNote(result);
  if (note !== null) deps.error(note);
}
