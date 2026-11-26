import { useState, type ReactNode } from "react";
import {
  BUILTIN_PRIVACY_NOTE,
  COLUMNS_CAPTION,
  columnStats,
  countText,
  DATA_NOT_AVAILABLE,
  DATA_PRIVACIES,
  kindWord,
  NOTES_NOT_AVAILABLE,
  PRIVACY_SENTENCE,
  QUERIES_EMPTY,
  REMOVE_SENTENCE,
  sampleCaption,
  SAMPLE_SCHEMA_NOTE,
  savedInText,
  sourceDetail,
  type DataPrivacy,
} from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs.tsx";
import { dataErrorText, type DataDescribeResult, type DataExtensionName, type DataSavedQuery, type DataSource, type DataTable } from "../../store/data.ts";
import { DATA_TABS, type DataTab } from "../../store/router.ts";
import { CodeEditor } from "../settings/config/code-editor.tsx";
import { ExtensionRow } from "./extension-row.tsx";
import { PrivacyChip } from "./privacy-chip.tsx";
import { RowsTable, type Rows } from "./rows-table.tsx";

/** What the notes tab has to show. */
export type NotesView =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "ready"; text: string | null; path: string | null };

const TAB_NAMES: Record<DataTab, string> = { tables: "Tables", notes: "Notes", queries: "Queries", settings: "Settings" };

function Caption({ children }: { children: ReactNode }) {
  return <h2 className="text-meta font-medium text-faint">{children}</h2>;
}

type SampleState = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; rows: Rows };

function TablesTab({
  source,
  described,
  onLoadSample,
}: {
  source: DataSource;
  described: DataDescribeResult | null;
  /** Reads the sample of one table. Only a schema-only source needs it: the rest came with the description. */
  onLoadSample: (table: string) => Promise<Rows>;
}) {
  const tables: readonly DataTable[] = described?.tables ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, SampleState>>({});
  if (described === null) return <p className="text-sm text-muted">Loading the tables.</p>;
  const table = tables.find((each) => each.name === picked) ?? tables[0];
  if (table === undefined) {
    return <p className="text-sm text-muted">{source.status === "ready" ? "No tables found." : sourceDetail(source)}</p>;
  }
  const columns = table.columns ?? [];
  const schemaOnly = source.privacy === "schema";
  const loaded = samples[table.name];
  const rows: Rows | null = schemaOnly ? (loaded?.state === "ready" ? loaded.rows : null) : (described.sample[table.name] ?? []);

  function showSample(name: string): void {
    setSamples((now) => ({ ...now, [name]: { state: "loading" } }));
    onLoadSample(name).then(
      (got) => setSamples((now) => ({ ...now, [name]: { state: "ready", rows: got } })),
      (failure: unknown) => setSamples((now) => ({ ...now, [name]: { state: "error", message: dataErrorText(failure, "Could not read the rows.") } })),
    );
  }

  return (
    <div className="flex min-h-0 gap-5">
      <ul aria-label="Tables" className="flex w-48 shrink-0 flex-col gap-px">
        {tables.map((each) => (
          <li key={each.name}>
            <button
              type="button"
              aria-current={each.name === table.name ? "true" : undefined}
              onClick={() => setPicked(each.name)}
              className={cn(
                "flex w-full flex-col rounded-md px-2.5 py-1.5 text-left outline-offset-2 outline-clay hover:bg-line focus-visible:outline-2",
                each.name === table.name ? "bg-surface text-ink ring-1 ring-line ring-inset" : "text-muted",
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
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium"><Code>{table.name}</Code></h2>
            <Badge>{table.rows === null || table.rows === undefined ? "rows hidden" : `${countText(table.rows)} rows`}</Badge>
          </div>
          <Caption>{COLUMNS_CAPTION}</Caption>
          <table className="w-full border-collapse text-code">
            <caption className="sr-only">Columns of {table.name}</caption>
            <thead>
              <tr className="border-b border-line-strong text-left text-faint">
                <th scope="col" className="px-2 py-1 font-normal">
                  name
                </th>
                <th scope="col" className="px-2 py-1 font-normal">
                  type
                </th>
                <th scope="col" className="px-2 py-1 font-normal">
                  stats
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.name} className="border-b border-line">
                  <td className="px-2 py-1"><Code>{column.name}</Code></td>
                  <td className="px-2 py-1"><Code tone="muted">{column.type}</Code></td>
                  <td className="px-2 py-1"><Code tone="muted">{columnStats(column)}</Code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="flex flex-col gap-1.5">
          <Caption>Sample rows · {sampleCaption(source.privacy)}</Caption>
          {rows !== null && rows.length > 0 ? (
            <RowsTable columns={columns} rows={rows} label={`Sample rows of ${table.name}`} />
          ) : schemaOnly && rows === null ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted">{SAMPLE_SCHEMA_NOTE}</p>
              <Button size="sm" disabled={loaded?.state === "loading"} onClick={() => showSample(table.name)}>
                {loaded?.state === "loading" ? "Reading rows…" : "Show sample rows"}
              </Button>
              {loaded?.state === "error" ? (
                <p role="alert" className="text-sm text-deny">
                  {loaded.message}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">No rows yet.</p>
          )}
        </section>
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

function QueriesTab({ queries, onRun }: { queries: readonly DataSavedQuery[]; onRun: (query: DataSavedQuery) => void }) {
  if (queries.length === 0) return <p className="text-sm text-muted">{QUERIES_EMPTY}</p>;
  return (
    <ul aria-label="Saved queries" className="flex max-w-3xl flex-col gap-2">
      {queries.map((query) => (
        <li key={query.name} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{query.name}</span>
            <span className="truncate text-meta text-faint">
              {query.description === null || query.description === undefined || query.description === "" ? "No description" : query.description} ·{" "}
              {query.last_run_at === null || query.last_run_at === undefined ? "never run" : `last run ${new Date(query.last_run_at).toLocaleDateString()}`}
            </span>
          </div>
          <Button size="sm" aria-label={`Run ${query.name}`} onClick={() => onRun(query)}>
            Run
          </Button>
        </li>
      ))}
    </ul>
  );
}

function SettingsTab({
  source,
  onPrivacy,
  onWatch,
  onRemove,
}: {
  source: DataSource;
  onPrivacy: (privacy: DataPrivacy) => Promise<void>;
  onWatch: (watch: boolean) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const builtin = source.scope === "builtin";

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
  onRun: (query: DataSavedQuery) => void;
  onLoadSample: (table: string) => Promise<Rows>;
  onSaveNotes: (text: string) => Promise<string>;
  onDraftNotes: () => Promise<string>;
  onPrivacy: (privacy: DataPrivacy) => Promise<void>;
  onWatch: (watch: boolean) => Promise<void>;
  onRemove: () => Promise<void>;
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
  onRun,
  onLoadSample,
  onSaveNotes,
  onDraftNotes,
  onPrivacy,
  onWatch,
  onRemove,
  onInstallExtension,
}: SourcePageProps) {
  const detail = sourceDetail(source);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 font-ui text-lg font-semibold">
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
      <Tabs value={tab} onValueChange={(next) => onTab(next as DataTab)} className="flex flex-col gap-4">
        <TabsList aria-label={`${source.name} details`}>
          {DATA_TABS.map((each) => (
            <TabsTrigger key={each} value={each}>
              {TAB_NAMES[each]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="tables">
          {describeMissing ? (
            <p className="text-sm text-muted">{DATA_NOT_AVAILABLE}</p>
          ) : describeError !== null ? (
            <p role="alert" className="text-sm text-deny">
              {describeError}
            </p>
          ) : (
            <TablesTab key={source.name} source={source} described={described} onLoadSample={onLoadSample} />
          )}
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab source={source} notes={notes} onSave={onSaveNotes} onDraft={onDraftNotes} />
        </TabsContent>
        <TabsContent value="queries">
          {described === null ? <p className="text-sm text-muted">{describeMissing ? DATA_NOT_AVAILABLE : "Loading the queries."}</p> : <QueriesTab queries={described.queries ?? []} onRun={onRun} />}
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab source={source} onPrivacy={onPrivacy} onWatch={onWatch} onRemove={onRemove} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
