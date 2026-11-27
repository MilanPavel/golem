import { useState } from "react";
import { lastRunOf, type RoutineConfigLike, NEW_QUERY_BUTTON, oneLineSql, QUERIES_EMPTY, QUERIES_EMPTY_MORE, QUERIES_LEDE, ranNowText } from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { writeClipboard } from "../../ui/clipboard.ts";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/menu.tsx";
import {
  dataErrorText,
  type DataExportParams,
  type DataExportResult,
  type DataExtensionName,
  type DataResult,
  type DataResultPageParams,
  type DataSavedQuery,
  type DataSaveQueryParams,
  type DataSource,
  type ToolTable,
} from "../../store/data.ts";
import type { QueryRoutineRequest } from "../../store/query-routines.ts";
import { EditQueryDialog } from "./query-dialogs.tsx";
import { QueryRoutineChip } from "./query-routine-chip.tsx";
import { QueryRoutineDialog } from "./query-routine-dialog.tsx";
import { ResultTable } from "./result-table.tsx";

/** What the tab needs to show and make the routines of its queries. Without it the tab has no Routine button. */
export type QueryRoutinesView = {
  /** The routine that runs this saved query, if any. */
  routineOf: (saved: string) => RoutineConfigLike | undefined;
  /** The names of the routines that exist, so a new name does not clash. */
  names: readonly string[];
  create: (request: QueryRoutineRequest) => Promise<void>;
  open: (name: string) => void;
};

export type QueriesTabProps = {
  source: DataSource;
  queries: readonly DataSavedQuery[];
  /** Runs the saved query by name, with no model. Rejects with the engine's words. */
  onRun: (name: string) => Promise<DataResult>;
  /** Runs SQL with a small limit, for Try. */
  onTry: (sql: string) => Promise<DataResult>;
  /** Opens a chat with the query in the composer. */
  onAsk: (query: DataSavedQuery) => void;
  onSave: (params: DataSaveQueryParams) => Promise<unknown>;
  onRemove: (name: string) => Promise<void>;
  onPage?: (params: DataResultPageParams) => Promise<DataResult>;
  onExport?: (params: DataExportParams) => Promise<DataExportResult>;
  onInstallExtension?: (name: DataExtensionName) => Promise<void>;
  routines?: QueryRoutinesView;
  /** The time the last runs are told against. Now by default. */
  now?: Date;
  /** For the gallery and tests: what is open when the tab shows. */
  initial?: { ran?: Record<string, { table: ToolTable; ms: number }>; editing?: string | "new"; confirming?: string; routine?: string };
};

type Ran = { table: ToolTable; ms: number };

function toTable(source: string, result: DataResult): ToolTable {
  return {
    result_id: result.result_id,
    source,
    columns: result.columns.map((column) => ({ name: column.name, type: column.type })),
    rows: result.rows as ToolTable["rows"],
    total_rows: result.total_rows ?? result.rows.length,
    truncated: result.truncated === true,
  };
}

/** `record` without `key`. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
}

function LastRun({ query, failure, now }: { query: DataSavedQuery; failure: string | undefined; now: Date }) {
  const last = failure === undefined ? lastRunOf(query, now) : { failed: true as const, when: "just now", detail: failure.split("\n")[0] ?? "" };
  if (last === null) return <span className="text-right text-meta text-faint">never run</span>;
  if (last.failed) {
    return (
      <span className="max-w-56 text-right text-meta text-deny">
        last run failed
        <br />
        <span className="line-clamp-2 text-faint wrap-anywhere" title={last.detail}>
          {last.detail}
        </span>
      </span>
    );
  }
  return (
    <span className="text-right text-meta text-faint">
      last run {last.when}
      {last.detail === null ? null : (
        <>
          <br />
          {last.detail}
        </>
      )}
    </span>
  );
}

/** The queries saved with a source: run one in place, ask about it in a chat, change it, copy its SQL or remove it. */
export function QueriesTab({ source, queries, onRun, onTry, onAsk, onSave, onRemove, onPage, onExport, onInstallExtension, routines, now, initial }: QueriesTabProps) {
  const [ran, setRan] = useState<Record<string, Ran>>(initial?.ran ?? {});
  const [running, setRunning] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | "new" | null>(initial?.editing ?? null);
  const [confirming, setConfirming] = useState<string | null>(initial?.confirming ?? null);
  const [scheduling, setScheduling] = useState<string | null>(initial?.routine ?? null);
  const [note, setNote] = useState<string | null>(null);
  const clock = now ?? new Date();

  function run(name: string): void {
    setRunning(name);
    setFailures((current) => without(current, name));
    onRun(name).then(
      (result) => {
        setRunning(null);
        setRan((current) => ({ ...current, [name]: { table: toTable(source.name, result), ms: result.elapsed_ms ?? 0 } }));
      },
      (failed: unknown) => {
        setRunning(null);
        setFailures((current) => ({ ...current, [name]: dataErrorText(failed, "The query did not run.") }));
      },
    );
  }

  function copy(query: DataSavedQuery): void {
    writeClipboard(query.sql).then(
      () => setNote(`Copied the SQL of "${query.name}".`),
      () => setNote("Could not reach the clipboard. Select the SQL in the Edit dialog and copy it."),
    );
  }

  function remove(name: string): void {
    setConfirming(null);
    onRemove(name).then(
      () => {
        setRan((current) => without(current, name));
        setNote(`Removed "${name}".`);
      },
      (failed: unknown) => setNote(dataErrorText(failed, "Could not remove the query.")),
    );
  }

  const editQuery = editing === null || editing === "new" ? null : (queries.find((each) => each.name === editing) ?? null);
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">{QUERIES_LEDE}</span>
        <Button size="sm" className="ml-auto shrink-0" aria-haspopup="dialog" onClick={() => setEditing("new")}>
          <span aria-hidden="true">+ </span>
          {NEW_QUERY_BUTTON}
        </Button>
      </div>
      {queries.length === 0 ? (
        <div className="flex max-w-xl flex-col gap-1 text-sm text-muted">
          <p>{QUERIES_EMPTY}</p>
          <p>{QUERIES_EMPTY_MORE}</p>
        </div>
      ) : (
        <ul aria-label="Saved queries" className="flex flex-col gap-2">
          {queries.map((query) => {
            const open = ran[query.name];
            const chip = routines?.routineOf(query.name);
            return (
              <li key={query.name} data-query={query.name} className="rounded-lg border border-line bg-surface">
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{query.name}</span>
                    {query.description === null || query.description === undefined || query.description === "" ? null : <span className="truncate text-meta text-muted">{query.description}</span>}
                    <span className="truncate text-meta text-faint" title={query.sql}>
                      <Code tone="inherit">{oneLineSql(query.sql)}</Code>
                    </span>
                    {chip === undefined || routines === undefined ? null : (
                      <span className="mt-0.5 flex">
                        <QueryRoutineChip config={chip} onOpen={routines.open} />
                      </span>
                    )}
                  </div>
                  <LastRun query={query} failure={failures[query.name]} now={clock} />
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" kind="primary" aria-label={`Run ${query.name}`} disabled={running === query.name} onClick={() => run(query.name)}>
                      <span aria-hidden="true">▶ </span>
                      {running === query.name ? "Running…" : "Run"}
                    </Button>
                    {routines === undefined ? null : (
                      <Button size="sm" aria-haspopup="dialog" aria-label={`Routine for ${query.name}`} onClick={() => setScheduling(query.name)}>
                        <span aria-hidden="true">⏱ </span>
                        Routine
                      </Button>
                    )}
                    <Button size="sm" aria-label={`Ask in chat: ${query.name}`} onClick={() => onAsk(query)}>
                      Ask in chat
                    </Button>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="sm" kind="ghost" aria-label={`More for ${query.name}`}>
                          <span aria-hidden="true">⋯</span>
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end">
                        <MenuItem onSelect={() => setEditing(query.name)}>Edit</MenuItem>
                        <MenuItem onSelect={() => copy(query)}>Copy SQL</MenuItem>
                        <MenuItem className="text-deny" onSelect={() => setConfirming(query.name)}>
                          Remove
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                </div>
                {confirming === query.name ? (
                  <div role="alertdialog" aria-label={`Remove ${query.name}`} className="flex flex-wrap items-center gap-2 border-t border-line bg-bg px-3 py-2 text-sm">
                    <span className="text-muted">Remove &quot;{query.name}&quot; from {source.name}? The source stays as it is.</span>
                    <Button size="sm" kind="danger" onClick={() => remove(query.name)}>
                      Remove
                    </Button>
                    <Button size="sm" kind="ghost" onClick={() => setConfirming(null)}>
                      Keep it
                    </Button>
                  </div>
                ) : null}
                {open === undefined ? null : (
                  <div className="rounded-b-lg border-t border-line bg-bg p-3">
                    <ResultTable
                      table={open.table}
                      heading={ranNowText(open.table.total_rows, open.ms)}
                      onClose={() => setRan((current) => without(current, query.name))}
                      {...(onPage === undefined ? {} : { onPage })}
                      {...(onExport === undefined ? {} : { onExport })}
                      {...(onInstallExtension === undefined ? {} : { onInstallExtension })}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {note === null ? null : (
        <p role="status" className="text-meta text-muted">
          {note}
        </p>
      )}
      {routines === undefined || scheduling === null ? null : (
        <QueryRoutineDialog
          open
          key={scheduling}
          source={{ name: source.name, kind: source.kind, location: source.location }}
          saved={scheduling}
          taken={routines.names}
          onCreate={routines.create}
          onClose={() => setScheduling(null)}
        />
      )}
      {editing === null ? null : (
        <EditQueryDialog
          open
          key={editing}
          source={source.name}
          query={editQuery}
          onTry={onTry}
          onSave={onSave}
          onRemove={async (name) => {
            await onRemove(name);
            setRan((current) => without(current, name));
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
