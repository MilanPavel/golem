import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { kindWord, PRIVACY_CHIP } from "@golem/view";
import { RpcError, type DataDescribeResult, type DataListResult, type DataResult, type GolemClient } from "@golem/client";

import type { DataArgs, ExportFormat } from "./data-command.ts";
import {
  formatDataDescribe,
  formatDataList,
  formatSavedQueries,
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
  /** Opens `text` in the person's editor and returns what they saved, or null when the editor failed. */
  edit?: (text: string, fileName: string) => Promise<string | null>;
  /** Asks for a secret and shows nothing as it is typed. Set only when stdin is a terminal. */
  readPassword?: (prompt: string) => Promise<string>;
  /** A new id for a query, so it can be cancelled by it. */
  newId?: () => string;
  /** The folder a relative file name is relative to. The process folder by default. */
  cwd?: () => string;
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

type Client = Pick<GolemClient, "addData" | "listData" | "describeData" | "queryData" | "cancelData" | "getDataNotes" | "setDataNotes" | "exportDataResult" | "saveDataQuery" | "removeDataQuery">;

/** `golem data list`. */
export async function runDataList(client: Client, json: boolean, deps: DataDeps): Promise<number> {
  const result: DataListResult = await guarded(() => client.listData());
  deps.write(`${json ? JSON.stringify(result, null, 2) : formatDataList(result.sources)}\n`);
  return 0;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
const PASSWORD_IN_ADDRESS = "That address has a password in it. Remove it: golem asks for the password separately and keeps it in the Keychain, never in a file.";

/** The database address in `location`, or null when it is a file or a folder. */
function databaseAddress(location: string): URL | null {
  if (!/^(postgres|postgresql|mysql):\/\//i.test(location)) return null;
  try {
    return new URL(location);
  } catch {
    return null;
  }
}

/** `golem data add`: a file, a folder, or a database whose password goes to the Keychain. */
export async function runDataAdd(client: Client, args: Extract<DataArgs, { kind: "add" }>, deps: DataDeps): Promise<number> {
  const address = databaseAddress(args.location);
  let password: string | null = null;
  if (address !== null) {
    if (address.password !== "") {
      deps.error(PASSWORD_IN_ADDRESS);
      return 1;
    }
    if (args.passwordStdin) {
      password = (await deps.readStdin()).replace(/\r?\n$/, "");
    } else if (deps.readPassword !== undefined) {
      const who = address.username === "" ? address.hostname : `${decodeURIComponent(address.username)}@${address.hostname}`;
      password = await deps.readPassword(`Password for ${who} (Enter for none): `);
    }
    if (password === "") password = null;
  } else if (args.passwordStdin) {
    deps.error("A file or a folder has no password.");
    return 1;
  }
  const privacy = args.privacy ?? (address !== null && !LOCAL_HOSTS.has(address.hostname.toLowerCase()) ? "schema" : "local");
  const added = await guarded(() => client.addData({ name: args.name, location: args.location, privacy, scope: "user", ...(password === null ? {} : { password }) }));
  const source = added.source;
  deps.write(`Added ${source.name} (${kindWord(source.kind)}, ${PRIVACY_CHIP[source.privacy]}).\n`);
  if (password !== null) deps.write(`The password is in the macOS Keychain as golem/data/${source.name}. It is not in config.toml.\n`);
  if (source.status === "error" && source.error) deps.write(`It could not be read yet: ${source.error}\n`);
  if (source.warning) deps.write(`${source.warning}\n`);
  return 0;
}

/** `golem data describe`. */
export async function runDataDescribe(client: Client, source: string, table: string | null, json: boolean, deps: DataDeps): Promise<number> {
  const result: DataDescribeResult = await guarded(() => client.describeData(source, table ?? undefined));
  deps.write(`${json ? JSON.stringify(result, null, 2) : formatDataDescribe(result)}\n`);
  return 0;
}

/** `golem data notes`: print the notes of a source, or with `--edit` change them in `$EDITOR`. */
export async function runDataNotes(client: Client, source: string, edit: boolean, deps: DataDeps): Promise<number> {
  const found = await guarded(() => client.getDataNotes(source));
  const current = found.text ?? "";
  if (!edit) {
    if (found.text === null || found.text === undefined) {
      deps.write(`No notes for ${source}. Write some with: golem data notes ${source} --edit\n`);
    } else {
      deps.write(found.text.endsWith("\n") ? found.text : `${found.text}\n`);
    }
    return 0;
  }
  if (deps.edit === undefined) {
    deps.error("There is no editor to open.");
    return 1;
  }
  const edited = await deps.edit(current, "DATA.md");
  if (edited === null) {
    deps.error("The editor did not finish, so nothing was saved.");
    return 1;
  }
  if (edited === current) {
    deps.write("No change.\n");
    return 0;
  }
  const saved = await guarded(() => client.setDataNotes(source, edited));
  deps.write(edited.trim() === "" ? `Removed the notes at ${saved.path}\n` : `Saved to ${saved.path}\n`);
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
    if (args.out !== undefined) return await exportResult(client, outcome.result_id, args.out, null, deps);
    printQuery(outcome, args.format, deps);
    if (args.format === "table") deps.error(`result ${outcome.result_id}: write it to a file with golem data export ${outcome.result_id} <file>`);
    return 0;
  } finally {
    unhook();
  }
}

/** `golem data query list`: the saved queries of a source. */
export async function runQueriesList(client: Client, source: string, json: boolean, deps: DataDeps): Promise<number> {
  const result: DataDescribeResult = await guarded(() => client.describeData(source));
  const queries = result.queries ?? [];
  deps.write(`${json ? JSON.stringify(queries, null, 2) : formatSavedQueries(queries, source)}\n`);
  return 0;
}

/** `golem data query run`: a saved query by name, with no model. */
export async function runQueriesRun(client: Client, args: Extract<DataArgs, { kind: "queries-run" }>, deps: DataDeps): Promise<number> {
  const resultId = (deps.newId ?? (() => `cli-${randomUUID()}`))();
  const result = await guarded(() => client.queryData({ source: args.source, saved: args.name, result_id: resultId, ...(args.limit === null ? {} : { limit: args.limit }) }));
  if (args.out !== undefined) return exportResult(client, result.result_id, args.out, null, deps);
  printQuery(result, args.format, deps);
  return 0;
}

/** `golem data query save`: keep a query with its source. A taken name needs `--replace`. */
export async function runQueriesSave(client: Client, args: Extract<DataArgs, { kind: "queries-save" }>, deps: DataDeps): Promise<number> {
  const saved = await guarded(() =>
    client.saveDataQuery({ source: args.source, name: args.name, sql: args.sql, ...(args.description === null ? {} : { description: args.description }), ...(args.replace ? { replace: true } : {}) }),
  );
  deps.write(`Saved "${saved.query.name}" with ${args.source}.\n`);
  return 0;
}

/** `golem data query remove`. */
export async function runQueriesRemove(client: Client, args: Extract<DataArgs, { kind: "queries-remove" }>, deps: DataDeps): Promise<number> {
  await guarded(() => client.removeDataQuery(args.source, args.name));
  deps.write(`Removed "${args.name}" from ${args.source}.\n`);
  return 0;
}

/** The path as the daemon should read it: `~` stays for the daemon, a relative name is made absolute here. */
function pathForDaemon(path: string, deps: DataDeps): string {
  return path.startsWith("~") || isAbsolute(path) ? path : resolve((deps.cwd ?? (() => process.cwd()))(), path);
}

async function exportResult(client: Client, resultId: string, path: string, format: ExportFormat | null, deps: DataDeps): Promise<number> {
  const result = await guarded(() => client.exportDataResult(resultId, pathForDaemon(path, deps), format ?? undefined));
  if (result.needs_extension !== undefined && result.needs_extension !== null) {
    deps.error(
      `Writing Excel needs a one-time download (2 MB) from extensions.duckdb.org. Nothing was written. Get it in the app, under Data, then run this again.`,
    );
    return 1;
  }
  deps.write(`Wrote ${result.rows} ${result.rows === 1 ? "row" : "rows"} to ${result.path}\n`);
  return 0;
}

/** `golem data export`: write a result of an earlier query to a new file. */
export async function runDataExport(client: Client, args: Extract<DataArgs, { kind: "export" }>, deps: DataDeps): Promise<number> {
  return exportResult(client, args.resultId, args.path, args.format, deps);
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
