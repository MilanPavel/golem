import { useId, useState, type ReactNode } from "react";
import {
  columnAlign,
  editQueryTitle,
  formatCell,
  isTakenName,
  NEW_QUERY_TITLE,
  queriesSavedText,
  QUERY_ANSWERS_LABEL,
  QUERY_ANSWERS_NOTE,
  QUERY_NAME_LABEL,
  QUERY_SQL_LABEL,
  QUERY_TRY_BUTTON,
  queryNameProblem,
  replaceQuestion,
  SAVE_QUERY_TITLE,
  triedText,
  TRY_ROWS,
  type ResultCell,
} from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Input } from "../../ui/input.tsx";
import { Textarea } from "../../ui/textarea.tsx";
import { dataErrorText, type DataResult, type DataSavedQuery, type DataSaveQueryParams } from "../../store/data.ts";

type Scope = "builtin" | "user" | "project";

/** The first rows of a query that was tried, or the engine's words. */
export type Tried = { kind: "rows"; columns: readonly { name: string; type: string }[]; rows: readonly (readonly ResultCell[])[]; total: number; ms: number } | { kind: "error"; message: string };

function TriedView({ tried }: { tried: Tried }) {
  if (tried.kind === "error") {
    return (
      <p role="alert" className="text-sm text-deny wrap-anywhere whitespace-pre-wrap">
        {tried.message}
      </p>
    );
  }
  const shown = tried.rows.slice(0, TRY_ROWS);
  return (
    <div className="flex flex-col gap-1.5">
      <p role="status" className="text-meta text-faint">
        {triedText(tried.total, tried.ms)}
        {tried.total > shown.length ? ` · the first ${String(shown.length)} are shown` : ""}
      </p>
      {tried.columns.length === 0 ? null : (
        <div role="group" aria-label="The first rows" tabIndex={0} className="max-h-44 overflow-auto rounded-md border border-line outline-offset-2 outline-clay focus-visible:outline-2">
          <table className="w-full border-collapse text-code">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line-strong">
                {tried.columns.map((column, index) => (
                  <th key={index} scope="col" className={cn("px-2 py-1 font-normal text-ink", columnAlign(column.type) === "right" ? "text-right" : "text-left")}>
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(tried.columns.length, 1)} className="px-2 py-2 text-muted">
                    The query returned no rows.
                  </td>
                </tr>
              ) : (
                shown.map((row, at) => (
                  <tr key={at} className="border-b border-line">
                    {tried.columns.map((column, index) => {
                      const cell = formatCell(row[index] ?? null);
                      return (
                        <td key={index} className={cn("px-2 py-1 whitespace-nowrap", cell.kind === "null" ? "text-faint" : "text-muted", columnAlign(column.type) === "right" ? "text-right tabular-nums" : "text-left")}>
                          <Code tone="inherit">{cell.text}</Code>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function triedOf(result: DataResult): Tried {
  return { kind: "rows", columns: result.columns, rows: result.rows, total: result.total_rows ?? result.rows.length, ms: result.elapsed_ms ?? 0 };
}

function Field({ id, label, note, children }: { id: string; label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
        {note === undefined ? null : <span className="text-faint"> ({note})</span>}
      </label>
      {children}
    </div>
  );
}

export type SaveQueryFormProps = {
  source: string;
  scope: Scope;
  sql: string;
  /** The name the form starts with: a short title from the question. */
  suggested: string;
  /** Keeps the query. Rejects with the daemon's reason; a taken name asks to replace. */
  onSave: (params: DataSaveQueryParams) => Promise<unknown>;
  onClose: () => void;
  inline?: boolean;
  initial?: { name?: string; description?: string; error?: string | null; taken?: boolean };
};

/** Save a query from a chat result: a name, what it answers, the SQL as it ran, and where it is kept. */
export function SaveQueryForm({ source, scope, sql, suggested, onSave, onClose, inline = false, initial }: SaveQueryFormProps) {
  const ids = useId();
  const [name, setName] = useState(initial?.name ?? suggested);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [taken, setTaken] = useState(initial?.taken ?? false);

  function save(replace: boolean): void {
    const problem = queryNameProblem(name);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    const text = description.trim();
    onSave({ source, name: name.trim(), sql, ...(text === "" ? {} : { description: text }), ...(replace ? { replace: true } : {}) }).then(
      () => {
        setBusy(false);
        onClose();
      },
      (failed: unknown) => {
        setBusy(false);
        const message = dataErrorText(failed, "Could not save the query.");
        if (isTakenName(message)) {
          setTaken(true);
          setError(null);
        } else {
          setError(message);
        }
      },
    );
  }

  const title = inline ? <h2 className="text-base font-semibold">{SAVE_QUERY_TITLE}</h2> : <DialogTitle>{SAVE_QUERY_TITLE}</DialogTitle>;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) save(taken);
      }}
    >
      {title}
      <div className="mt-3 flex flex-col gap-3">
        <Field id={`${ids}-name`} label={QUERY_NAME_LABEL}>
          <Input
            id={`${ids}-name`}
            value={name}
            autoFocus={!inline}
            maxLength={120}
            aria-invalid={error === null ? undefined : true}
            onChange={(event) => {
              setName(event.target.value);
              setTaken(false);
            }}
          />
        </Field>
        <Field id={`${ids}-answers`} label={QUERY_ANSWERS_LABEL} note={QUERY_ANSWERS_NOTE}>
          <Input id={`${ids}-answers`} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">{QUERY_SQL_LABEL}</span>
          <pre tabIndex={0} aria-label="The SQL that ran" className="max-h-48 overflow-auto rounded-md border border-line bg-sunken p-2.5 font-mono text-code leading-relaxed text-ink-soft outline-offset-2 outline-clay focus-visible:outline-2">
            {sql}
          </pre>
        </div>
        <p className="text-meta text-faint">{queriesSavedText(source, scope)}</p>
        {taken ? (
          <p role="alert" className="text-sm text-wait">
            {replaceQuestion(name.trim())} A query with that name is already saved. Replacing swaps its SQL for this one.
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny wrap-anywhere">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" kind="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button kind="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : taken ? "Replace" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** The Save dialog. It forgets what was typed when it closes. */
export function SaveQueryDialog({ open, ...form }: SaveQueryFormProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : form.onClose())}>
      <DialogContent className="max-w-lg">
        <DialogDescription className="sr-only">Keep this query with {form.source} so you can run it again.</DialogDescription>
        <SaveQueryForm {...form} />
      </DialogContent>
    </Dialog>
  );
}

export type EditQueryFormProps = {
  source: string;
  /** The query being changed, or null for a new one. */
  query: DataSavedQuery | null;
  /** Runs the SQL with a small limit. Rejects with the engine's words. */
  onTry: (sql: string) => Promise<DataResult>;
  onSave: (params: DataSaveQueryParams) => Promise<unknown>;
  /** Deletes the query. Only an edit has it. */
  onRemove?: (name: string) => Promise<void>;
  onClose: () => void;
  inline?: boolean;
  initial?: { tried?: Tried; confirmRemove?: boolean; taken?: boolean };
};

/** One dialog for a new query and for changing one. Try shows the first rows or the engine's error before anything is saved. */
export function EditQueryForm({ source, query, onTry, onSave, onRemove, onClose, inline = false, initial }: EditQueryFormProps) {
  const ids = useId();
  const [name, setName] = useState(query?.name ?? "");
  const [description, setDescription] = useState(query?.description ?? "");
  const [sql, setSql] = useState(query?.sql ?? "");
  const [tried, setTried] = useState<Tried | null>(initial?.tried ?? null);
  const [trying, setTrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(initial?.taken ?? false);
  const [confirming, setConfirming] = useState(initial?.confirmRemove ?? false);

  function tryIt(): void {
    if (sql.trim() === "") {
      setTried({ kind: "error", message: "Write a query first." });
      return;
    }
    setTrying(true);
    onTry(sql).then(
      (result) => {
        setTrying(false);
        setTried(triedOf(result));
      },
      (failed: unknown) => {
        setTrying(false);
        setTried({ kind: "error", message: dataErrorText(failed, "The query did not run.") });
      },
    );
  }

  function save(replace: boolean): void {
    const problem = queryNameProblem(name);
    if (problem !== null) {
      setError(problem);
      return;
    }
    if (sql.trim() === "") {
      setError("Write the query first.");
      return;
    }
    setError(null);
    setBusy(true);
    const text = description.trim();
    onSave({
      source,
      name: name.trim(),
      sql,
      ...(text === "" ? {} : { description: text }),
      ...(query === null ? {} : { previous_name: query.name }),
      ...(replace ? { replace: true } : {}),
    }).then(
      () => {
        setBusy(false);
        onClose();
      },
      (failed: unknown) => {
        setBusy(false);
        const message = dataErrorText(failed, "Could not save the query.");
        if (isTakenName(message)) {
          setTaken(true);
          setError(null);
        } else {
          setError(message);
        }
      },
    );
  }

  function remove(): void {
    if (query === null || onRemove === undefined) return;
    setBusy(true);
    onRemove(query.name).then(
      () => {
        setBusy(false);
        onClose();
      },
      (failed: unknown) => {
        setBusy(false);
        setConfirming(false);
        setError(dataErrorText(failed, "Could not remove the query."));
      },
    );
  }

  const heading = query === null ? NEW_QUERY_TITLE : editQueryTitle(query.name);
  const title = inline ? <h2 className="text-base font-semibold">{heading}</h2> : <DialogTitle>{heading}</DialogTitle>;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) save(taken);
      }}
    >
      {title}
      <div className="mt-3 flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${ids}-name`} label={QUERY_NAME_LABEL}>
            <Input
              id={`${ids}-name`}
              value={name}
              autoFocus={!inline && query === null}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                setTaken(false);
              }}
            />
          </Field>
          <Field id={`${ids}-answers`} label={QUERY_ANSWERS_LABEL} note={QUERY_ANSWERS_NOTE}>
            <Input id={`${ids}-answers`} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </div>
        <Field id={`${ids}-sql`} label={QUERY_SQL_LABEL}>
          <Textarea id={`${ids}-sql`} value={sql} spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={6} className="font-mono text-code" onChange={(event) => setSql(event.target.value)} />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={trying} onClick={tryIt}>
            <span aria-hidden="true">▶ </span>
            {trying ? "Running…" : QUERY_TRY_BUTTON}
          </Button>
          <span className="text-meta text-faint">Runs it on {source} and shows the first rows. Only queries that read can run.</span>
        </div>
        {tried === null ? null : <TriedView tried={tried} />}
        {taken ? (
          <p role="alert" className="text-sm text-wait">
            {replaceQuestion(name.trim())} A query with that name is already saved. Replacing swaps its SQL for this one.
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-deny wrap-anywhere">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        {query === null || onRemove === undefined ? (
          <span />
        ) : confirming ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Remove &quot;{query.name}&quot; from {source}? The source stays as it is.</span>
            <Button type="button" size="sm" kind="danger" disabled={busy} onClick={remove}>
              Remove
            </Button>
            <Button type="button" size="sm" kind="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </span>
        ) : (
          <Button type="button" kind="ghost" className="text-deny" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
        <span className="flex gap-2">
          <Button type="button" kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : taken ? "Replace" : "Save"}
          </Button>
        </span>
      </div>
    </form>
  );
}

/** The New and Edit dialog. */
export function EditQueryDialog({ open, ...form }: EditQueryFormProps & { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : form.onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogDescription className="sr-only">Change a query kept with {form.source}.</DialogDescription>
        <EditQueryForm {...form} />
      </DialogContent>
    </Dialog>
  );
}
