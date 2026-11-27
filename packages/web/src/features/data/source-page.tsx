import { useId, useState, type ReactNode } from "react";
import {
  BUILTIN_PRIVACY_NOTE,
  countText,
  DATA_NOT_AVAILABLE,
  DATA_PRIVACIES,
  keychainLine,
  kindWord,
  limitsLine,
  NOTES_NOT_AVAILABLE,
  PASSWORD_NOTE,
  PRIVACY_SENTENCE,
  withoutSingleFile,
  REMOVE_SENTENCE,
  savedInText,
  sourceDetail,
  type DataPrivacy,
  type ViewCell,
} from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { DataSourceIcon } from "../../ui/data-icons.tsx";
import { Input } from "../../ui/input.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { dataErrorText, type DataBrowseKeepResult, type DataBrowseKeepView, type DataBrowseResult, type DataBrowseView, type DataExportParams, type DataExportResult, type DataDescribeResult, type DataExtensionName, type DataProfileResult, type DataSavedQuery, type DataSource, type DataTable, type DataResult, type DataResultPageParams, type DataSaveQueryParams } from "../../store/data.ts";
import { DATA_TABS, type DataTab } from "../../store/router.ts";
import { CodeEditor } from "../settings/config/code-editor.tsx";
import { ExtensionRow } from "./extension-row.tsx";
import { PrivacyChip } from "./privacy-chip.tsx";
import { QueriesTab } from "./queries-tab.tsx";
import { ColumnProfile } from "./column-profile.tsx";
import { EMPTY_VIEW, RowsBrowser, type RowsView } from "./rows-browser.tsx";

/** What the notes tab has to show. */
export type NotesView =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "ready"; text: string | null; path: string | null };

/** The `tables` tab is the one with a chart for each column, so it is called Columns. */
const TAB_NAMES: Record<DataTab, string> = { tables: "Columns", rows: "Rows", notes: "Notes", queries: "Queries", settings: "Settings" };

function Caption({ children }: { children: ReactNode }) {
  return <h2 className="text-meta font-medium text-faint">{children}</h2>;
}

/** The tables of a source as a list to pick from. A source with one table has nothing to pick. */
function TableList({ tables, current, onPick }: { tables: readonly DataTable[]; current: string; onPick: (name: string) => void }) {
  return (
    <ul aria-label="Tables" className="flex w-48 shrink-0 flex-col gap-px">
      {tables.map((each) => (
        <li key={each.name}>
          <button
            type="button"
            aria-current={each.name === current ? "true" : undefined}
            onClick={() => onPick(each.name)}
            className={cn(
              "flex w-full flex-col rounded-md px-2.5 py-1.5 text-left outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2",
              each.name === current ? "bg-surface text-ink ring-1 ring-line ring-inset" : "text-muted",
            )}
          >
            <Code className="truncate text-sm">{each.name}</Code>
            <span className="text-xs text-faint">
              {each.rows === null || each.rows === undefined ? "rows hidden" : `${countText(each.rows)} rows`} · {(each.columns ?? []).length} columns
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The frame of the Columns and Rows tabs: the list of tables when there are several, and one table's heading above its content. */
function TableFrame({ source, described, picked, onPick, children }: { source: DataSource; described: DataDescribeResult | null; picked: string | null; onPick: (name: string) => void; children: (table: DataTable) => ReactNode }) {
  const tables: readonly DataTable[] = described?.tables ?? [];
  if (described === null) return <p className="text-sm text-muted">Loading the tables.</p>;
  const table = tables.find((each) => each.name === picked) ?? tables[0];
  if (table === undefined) {
    return <p className="text-sm text-muted">{source.status === "ready" ? "No tables found." : sourceDetail(source)}</p>;
  }
  return (
    <div className="flex min-h-0 gap-5">
      {tables.length > 1 ? <TableList tables={tables} current={table.name} onPick={onPick} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">
            <Code>{table.name}</Code>
          </h2>
          <Badge>{table.rows === null || table.rows === undefined ? "rows hidden" : `${countText(table.rows)} rows`}</Badge>
        </div>
        {children(table)}
      </div>
    </div>
  );
}

function NotesTab({
  source,
  notes,
  onSave,
  onDraft,
}: {
  source: DataSource;
  notes: NotesView;
  onSave: (text: string) => Promise<string>;
  onDraft: () => Promise<string>;
}) {
  if (notes.state === "loading") return <p className="text-sm text-muted">Loading the notes.</p>;
  if (notes.state === "missing") return <p className="text-sm text-muted">{NOTES_NOT_AVAILABLE}</p>;
  if (notes.state === "error") {
    return (
      <p role="alert" className="text-sm text-deny">
        {notes.message}
      </p>
    );
  }
  return <NotesEditor key={source.name} source={source} initial={notes.text ?? ""} path={notes.path ?? source.notes_path ?? null} onSave={onSave} onDraft={onDraft} />;
}

function NotesEditor({ source, initial, path, onSave, onDraft }: { source: DataSource; initial: string; path: string | null; onSave: (text: string) => Promise<string>; onDraft: () => Promise<string> }) {
  const [saved, setSaved] = useState(initial);
  const [where, setWhere] = useState(path);
  const [editing, setEditing] = useState<string | null>(null);
  const [proposal, setProposal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "draft" | null>(null);
  const empty = saved.trim() === "";

  function save(text: string, then: () => void): void {
    setBusy("save");
    setError(null);
    onSave(text).then(
      (at) => {
        setSaved(text.trim() === "" ? "" : text);
        setWhere(at);
        setNotice(text.trim() === "" ? "The notes are gone." : `Saved to ${at}.`);
        setBusy(null);
        then();
      },
      (failure: unknown) => {
        setError(dataErrorText(failure, "Could not save the notes."));
        setBusy(null);
      },
    );
  }

  function draft(): void {
    setBusy("draft");
    setError(null);
    setNotice(null);
    onDraft().then(
      (text) => {
        setProposal(text);
        setBusy(null);
      },
      (failure: unknown) => {
        setError(dataErrorText(failure, "Could not draft the notes."));
        setBusy(null);
      },
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 break-all text-meta text-faint">{where === null ? "Not saved yet" : <Code tone="muted">{where}</Code>}</p>
        {editing === null && proposal === null ? (
          <>
            <Button size="sm" disabled={busy !== null} onClick={draft}>
              {busy === "draft" ? "Drafting…" : empty ? "Draft notes" : "Draft with golem"}
            </Button>
            <Button size="sm" kind="primary" disabled={busy !== null} onClick={() => setEditing(saved)}>
              Edit
            </Button>
          </>
        ) : null}
      </div>
      <p className="text-sm text-muted">What the tables mean, in your words. The model reads this before it writes a query. Correct whatever golem got wrong.</p>
      {proposal !== null ? (
        <section aria-label="Drafted notes" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <p role="status" className="text-sm text-wait">
            golem drafted these from the schema. They are not saved until you accept.
          </p>
          <pre className="whitespace-pre-wrap break-words font-mono text-sm">{proposal}</pre>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" kind="primary" disabled={busy !== null} onClick={() => save(proposal, () => setProposal(null))}>
              {busy === "save" ? "Saving…" : "Accept"}
            </Button>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                setEditing(proposal);
                setProposal(null);
              }}
            >
              Edit first
            </Button>
            <Button size="sm" disabled={busy !== null} onClick={() => setProposal(null)}>
              Discard
            </Button>
          </div>
        </section>
      ) : editing !== null ? (
        <>
          <CodeEditor value={editing} onChange={setEditing} marked={new Set()} label={`Notes of ${source.name}`} language="markdown" />
          <div className="flex gap-2">
            <Button size="sm" kind="primary" disabled={busy !== null} onClick={() => save(editing, () => setEditing(null))}>
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" disabled={busy !== null} onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </>
      ) : empty ? (
        <p className="text-sm text-muted">No notes yet. golem can draft them from the schema, and nothing is saved until you accept.</p>
      ) : (
        <pre aria-label={`Notes of ${source.name}`} className="whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 font-mono text-sm">
          {saved}
        </pre>
      )}
      {notice === null || proposal !== null ? null : (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

/** The password of a database source: where it is kept, and a way to store a new one. The old one is never shown. */
function PasswordRow({ source, onChange, busy, attempt }: { source: DataSource; onChange: (password: string) => Promise<void>; busy: boolean; attempt: (work: () => Promise<void>, fallback: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const id = useId();
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-faint">Password</dt>
      <dd className="flex min-w-0 flex-col gap-1.5">
        <span>{source.in_keychain === true ? keychainLine(source.name) : "none stored: the login has no password"}</span>
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (value === "") return;
              attempt(
                () =>
                  onChange(value).then(() => {
                    setValue("");
                    setEditing(false);
                  }),
                "Could not store the password.",
              );
            }}
          >
            <label htmlFor={id} className="sr-only">
              New password
            </label>
            <Input id={id} type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="new-password" className="w-56" />
            <Button size="sm" kind="primary" type="submit" disabled={busy || value === ""}>
              Store password
            </Button>
            <Button
              size="sm"
              kind="ghost"
              onClick={() => {
                setValue("");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <span className="basis-full text-meta text-muted">{PASSWORD_NOTE}</span>
          </form>
        ) : (
          <span>
            <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
              Change password
            </Button>
          </span>
        )}
      </dd>
    </div>
  );
}

function SettingsTab({
  source,
  onPrivacy,
  onWatch,
  onRemove,
  onChangePassword,
}: {
  source: DataSource;
  onPrivacy: (privacy: DataPrivacy) => Promise<void>;
  onWatch: (watch: boolean) => Promise<void>;
  onRemove: () => Promise<void>;
  onChangePassword?: (password: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const builtin = source.scope === "builtin";
  const server = source.kind === "postgres" || source.kind === "mysql";

  function attempt(work: () => Promise<void>, fallback: string): void {
    setError(null);
    setBusy(true);
    work().then(
      () => setBusy(false),
      (failure: unknown) => {
        setError(dataErrorText(failure, fallback));
        setBusy(false);
      },
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <section className="flex flex-col gap-2">
        <Caption>Who may see rows</Caption>
        {builtin ? (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-2 text-sm">
              <PrivacyChip privacy="open" /> {PRIVACY_SENTENCE.open}
            </p>
            <p className="text-sm text-muted">{BUILTIN_PRIVACY_NOTE}</p>
          </div>
        ) : (
          <div role="radiogroup" aria-label="Who may see rows" className="flex flex-col gap-2">
            {DATA_PRIVACIES.map((level) => {
              const on = source.privacy === level;
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={busy}
                  onClick={() => (on ? undefined : attempt(() => onPrivacy(level), "Could not change the privacy."))}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left outline-offset-2 outline-clay focus-visible:outline-2 disabled:opacity-60",
                    on ? "border-clay bg-clay-soft" : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <PrivacyChip privacy={level} className="mt-0.5 shrink-0" />
                  <span className="text-sm text-muted">{PRIVACY_SENTENCE[level]}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <Caption>Source</Caption>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-faint">Where</dt>
            <dd className="min-w-0 break-all">
              <Code>{source.location}</Code>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-faint">Saved in</dt>
            <dd>{savedInText(source.scope)}</dd>
          </div>
          {server && onChangePassword !== undefined ? <PasswordRow source={source} onChange={onChangePassword} busy={busy} attempt={attempt} /> : null}
          {server ? (
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-faint">Limits</dt>
              <dd>{limitsLine(source.timeout_s)}</dd>
            </div>
          ) : null}
          {server && source.warning != null ? (
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-faint">Login</dt>
              <dd className="text-wait">
                <span role="status">{source.warning}</span>
              </dd>
            </div>
          ) : null}
          {source.kind === "files" && !builtin ? (
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-faint">New files</dt>
              <dd>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={source.watch === true} disabled={busy} onChange={(event) => attempt(() => onWatch(event.target.checked), "Could not change this.")} />
                  Watch the folder
                </label>
                <p className="mt-0.5 text-meta text-muted">golem reads new files on the next query.</p>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
      {builtin ? null : (
        <section className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button kind="danger" disabled={busy} onClick={() => attempt(onRemove, "Could not remove the source.")}>
            Remove source
          </Button>
          <p className="text-sm text-muted">{REMOVE_SENTENCE}</p>
        </section>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {error}
        </p>
      )}
    </div>
  );
}

export type SourcePageProps = {
  source: DataSource;
  /** `data.describe` for this source, or null while it loads. */
  described: DataDescribeResult | null;
  /** The daemon does not know `data.describe`. */
  describeMissing?: boolean;
  /** Why the description did not come. */
  describeError?: string | null;
  notes: NotesView;
  tab: DataTab;
  onTab: (tab: DataTab) => void;
  /** Opens a new chat with `@name` in the composer. */
  onAsk: () => void;
  /** Opens a chat that runs a saved query. */
  onAskQuery: (query: DataSavedQuery) => void;
  /** Runs a saved query by name, with no model. */
  onRunQuery: (name: string) => Promise<DataResult>;
  /** Runs SQL with a small limit, for Try in the New and Edit dialog. */
  onTryQuery: (sql: string) => Promise<DataResult>;
  onSaveQuery: (params: DataSaveQueryParams) => Promise<unknown>;
  onRemoveQuery: (name: string) => Promise<void>;
  /** One page of a kept result, for a result that opened under a query. */
  onPage?: (params: DataResultPageParams) => Promise<DataResult>;
  onExport?: (params: DataExportParams) => Promise<DataExportResult>;
  /** The shape of each column of one table, from `data.profile`. */
  onLoadProfile: (table: string) => Promise<DataProfileResult>;
  /** One page of a table, from `data.browse`. */
  onBrowse: (table: string, view: DataBrowseView) => Promise<DataBrowseResult>;
  /** Opens a new chat with this text in the composer, to ask about a view of the rows. */
  onAskView: (text: string) => void;
  /** Keeps the whole current view of a table as a result to export. Without it the Rows tab has no Export button. */
  onKeepView?: (table: string, view: DataBrowseKeepView) => Promise<DataBrowseKeepResult>;
  /** Writes a kept view to a new file. */
  onExportView?: (params: DataExportParams) => Promise<DataExportResult>;
  onSaveNotes: (text: string) => Promise<string>;
  onDraftNotes: () => Promise<string>;
  onPrivacy: (privacy: DataPrivacy) => Promise<void>;
  onWatch: (watch: boolean) => Promise<void>;
  onRemove: () => Promise<void>;
  /** Stores a new password for a database source in the Keychain. Without it the page has no Change password button. */
  onChangePassword?: (password: string) => Promise<void>;
  /** Downloads the add-on the source needs. Without it the page only says the add-on is missing. */
  onInstallExtension?: (name: DataExtensionName) => Promise<void>;
};

/** One source in the main area: a top bar, then the Tables, Notes, Queries and Settings tabs. */
export function SourcePage({
  source,
  described,
  describeMissing = false,
  describeError = null,
  notes,
  tab,
  onTab,
  onAsk,
  onAskQuery,
  onRunQuery,
  onTryQuery,
  onSaveQuery,
  onRemoveQuery,
  onPage,
  onExport,
  onLoadProfile,
  onBrowse,
  onAskView,
  onKeepView,
  onExportView,
  onSaveNotes,
  onDraftNotes,
  onPrivacy,
  onWatch,
  onRemove,
  onChangePassword,
  onInstallExtension,
}: SourcePageProps) {
  const detail = sourceDetail(source);
  const [picked, setPicked] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, RowsView>>({});
  const viewOf = (table: string): RowsView => views[table] ?? EMPTY_VIEW;
  // A click on a bar of a category opens the rows with that value.
  const openRows = (table: string, column: string, value: ViewCell): void => {
    setViews((now) => ({ ...now, [table]: { ...EMPTY_VIEW, filters: [{ column, op: "=", value }] } }));
    onTab("rows");
  };
  return (
    <Tabs value={tab} onValueChange={(next) => onTab(next as DataTab)} className="flex min-w-0 flex-col gap-4">
      {/* Stays at the top of the page while the rest scrolls. The negative margins and offset cancel the page's padding, so nothing shows above or beside it. */}
      <div data-sticky="source-header" className="sticky -top-5 z-30 -mx-7 -mt-5 flex flex-col gap-4 bg-bg px-7 pt-5">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <h1 className="flex flex-wrap items-center gap-2 font-ui text-lg font-semibold">
              <DataSourceIcon kind={source.kind} location={source.location} className="shrink-0 text-muted" />
              <span className="min-w-0 truncate">{source.name}</span>
              <PrivacyChip privacy={source.privacy} />
              <Badge>{kindWord(source.kind)}</Badge>
            </h1>
            <p className="break-all text-meta text-muted"><Code tone="muted">{source.location}</Code></p>
            {source.status === "ready" ? null : (
              <p role={source.status === "error" ? "alert" : undefined} className={cn("text-meta", source.status === "error" ? "text-deny" : source.status === "untrusted" ? "text-wait" : "text-muted")}>
                {detail}
              </p>
            )}
          </div>
          <Button kind="primary" size="sm" onClick={onAsk}>
            Ask in a chat
          </Button>
          {source.needs_extension != null && onInstallExtension !== undefined ? (
            <div className="basis-full">
              <ExtensionRow name={source.needs_extension} onInstall={onInstallExtension} />
            </div>
          ) : null}
        </header>
        <TabsList aria-label={`${source.name} details`}>
          {DATA_TABS.map((each) => (
            <TabsTrigger key={each} value={each}>
              {TAB_NAMES[each]}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="tables">
        {describeMissing ? (
          <p className="text-sm text-muted">{DATA_NOT_AVAILABLE}</p>
        ) : describeError !== null ? (
          <p role="alert" className="text-sm text-deny">
            {describeError}
          </p>
        ) : (
          <TableFrame source={source} described={described} picked={picked} onPick={setPicked}>
            {(table) => <ColumnProfile key={table.name} table={table} refresh={described} onLoadProfile={onLoadProfile} onPick={(column, value) => openRows(table.name, column, value)} />}
          </TableFrame>
        )}
      </TabsContent>
      <TabsContent value="rows">
        {describeMissing ? (
          <p className="text-sm text-muted">{DATA_NOT_AVAILABLE}</p>
        ) : describeError !== null ? (
          <p role="alert" className="text-sm text-deny">
            {describeError}
          </p>
        ) : (
          <TableFrame source={source} described={described} picked={picked} onPick={setPicked}>
            {(table) => {
              const shown = withoutSingleFile(table.columns ?? [], []).columns;
              return <RowsBrowser key={table.name} source={source.name} table={table.name} columns={shown} tableRows={table.rows ?? null} view={viewOf(table.name)} onView={(next) => setViews((now) => ({ ...now, [table.name]: next }))} onBrowse={onBrowse} onAskView={onAskView} {...(onKeepView === undefined ? {} : { onKeep: onKeepView })} {...(onExportView === undefined ? {} : { onExport: onExportView })} {...(onInstallExtension === undefined ? {} : { onInstallExtension })} />;
            }}
          </TableFrame>
        )}
      </TabsContent>
      <TabsContent value="notes">
        <NotesTab source={source} notes={notes} onSave={onSaveNotes} onDraft={onDraftNotes} />
      </TabsContent>
      <TabsContent value="queries">
        {described === null ? <p className="text-sm text-muted">{describeMissing ? DATA_NOT_AVAILABLE : "Loading the queries."}</p> : <QueriesTab source={source} queries={described.queries ?? []} onRun={onRunQuery} onTry={onTryQuery} onAsk={onAskQuery} onSave={onSaveQuery} onRemove={onRemoveQuery} {...(onPage === undefined ? {} : { onPage })} {...(onExport === undefined ? {} : { onExport })} {...(onInstallExtension === undefined ? {} : { onInstallExtension })} />}
      </TabsContent>
      <TabsContent value="settings">
        <SettingsTab source={source} onPrivacy={onPrivacy} onWatch={onWatch} onRemove={onRemove} {...(onChangePassword === undefined ? {} : { onChangePassword })} />
      </TabsContent>
    </Tabs>
  );
}
