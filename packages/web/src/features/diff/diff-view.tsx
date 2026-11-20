import "./diff.css";
import { parseDiff, type ReviewNote } from "@golem/view";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Textarea } from "../../ui/textarea.tsx";
import type { DiffMode } from "./diff-mode.ts";
import { diffFile, splitRows, unifiedRows, type Cell, type NoteRow } from "./rows.ts";

const TONE = {
  add: "bg-allow-soft",
  del: "bg-deny-soft",
  context: "",
} as const;

const SIGN = {
  add: "text-allow",
  del: "text-deny",
  context: "text-faint",
} as const;

const NUMBER = "select-none px-2 text-right align-top text-faint";

function Note({ row, span, action }: { row: NoteRow; span: number; action?: ReactNode }) {
  return (
    <tr data-row={row.kind}>
      <td colSpan={span} className={cn("whitespace-pre px-2 text-muted", row.kind === "hunk" && "bg-sunken")}>
        {action === undefined || action === null ? null : <span className="sticky left-2 mr-3 inline-block">{action}</span>}
        {row.text}
      </td>
    </tr>
  );
}

/** The row a note is written on: the file, the line number on one side of the diff, and the code shown there. */
export type NoteLine = { path: string; line: number; side: "new" | "old"; code: string };

/** What makes a diff take review notes. Unified layout only. */
export type DiffNotes = {
  /** The notes of this file. */
  notes: readonly ReviewNote[];
  onAddNote: (line: NoteLine, text: string) => void;
  onEditNote: (id: string, text: string) => void;
  onRemoveNote: (id: string) => void;
};

const NOTE_BUTTON =
  "rounded-sm border border-line-strong bg-surface px-1.5 py-0 text-xs text-ink outline-offset-2 outline-clay hover:border-ink focus-visible:outline-2";

function NoteEditor({
  label,
  initial,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const save = () => {
    if (text.trim() !== "") onSave(text.trim());
  };
  return (
    <tr data-row="note-editor">
      <td colSpan={5} className="p-2">
        <div className="sticky left-0 flex w-full max-w-xl flex-col gap-2 whitespace-normal">
          <Textarea
            autoFocus
            aria-label={label}
            rows={3}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                save();
              }
            }}
          />
          <div className="flex gap-2">
            <Button kind="primary" size="sm" disabled={text.trim() === ""} onClick={save}>
              Save
            </Button>
            <Button kind="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function SavedNote({ note, onEdit, onRemove }: { note: ReviewNote; onEdit: () => void; onRemove: () => void }) {
  return (
    <tr data-row="note">
      <td colSpan={5} className="p-2">
        <div role="group" aria-label={`Note on line ${note.line}`} className="sticky left-0 flex w-full max-w-xl flex-col gap-1 rounded-sm bg-wait-soft px-3 py-2 font-ui text-sm whitespace-normal text-ink">
          <p className="whitespace-pre-wrap wrap-anywhere">{note.text}</p>
          <div className="flex gap-2">
            <button type="button" className={NOTE_BUTTON} aria-label={`Edit the note on line ${note.line}`} onClick={onEdit}>
              Edit
            </button>
            <button type="button" className={NOTE_BUTTON} aria-label={`Remove the note on line ${note.line}`} onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function Half({ cell, divider }: { cell: Cell | null; divider: boolean }) {
  const tone = cell ? TONE[cell.tone] : "";
  const edge = divider ? "border-l border-line" : "";
  return (
    <>
      <td className={cn(NUMBER, tone, edge)}>{cell?.n}</td>
      <td className={cn("w-4 select-none text-center align-top", tone, cell ? SIGN[cell.tone] : "")}>{cell?.sign.trim()}</td>
      <td className={cn("pr-3 align-top whitespace-pre-wrap wrap-anywhere text-ink", tone)}>{cell?.text}</td>
    </>
  );
}

/**
 * A unified diff as a table: the line numbers of both files, the sign in its own column, and
 * the text. Long lines scroll sideways. The text is React children, never markup.
 */
export function DiffView({
  diff,
  mode,
  notes,
  onHunkAction,
}: {
  diff: string;
  mode: DiffMode;
  notes?: DiffNotes;
  /** Draws a control in each hunk header. `index` is the hunk's place in this diff, from 0. */
  onHunkAction?: (index: number) => ReactNode;
}) {
  const { file, unified, split } = useMemo(() => {
    const lines = parseDiff(diff);
    return { file: diffFile(lines), unified: unifiedRows(lines), split: splitRows(lines) };
  }, [diff]);
  const isSplit = mode === "split";
  // A hunk header's place among the hunk headers, for the control it may carry.
  const hunkAction = (rows: readonly { kind: string }[], at: number): ReactNode => {
    if (onHunkAction === undefined) return undefined;
    let index = 0;
    for (let i = 0; i < at; i += 1) if (rows[i]?.kind === "hunk") index += 1;
    return onHunkAction(index);
  };
  // The editor that is open: a new note is "add:<side>:<line>", an old one "edit:<id>".
  const [editing, setEditing] = useState<string | null>(null);
  const noting = notes !== undefined && !isSplit && file.path !== null;
  const span = isSplit ? 6 : noting ? 5 : 4;
  return (
    <div data-diff-mode={mode} className="min-w-0">
      {file.path !== null ? (
        <p className="mb-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
          <span className="wrap-anywhere text-ink">{file.path}</span>
          {file.added ? <span className="rounded-xs bg-allow-soft px-1.5 text-allow">new file</span> : null}
          {file.deleted ? <span className="rounded-xs bg-deny-soft px-1.5 text-deny">deleted</span> : null}
        </p>
      ) : null}
      {/* relative: the hidden caption and header are absolutely placed, and must stay inside this box. */}
      <div className="relative overflow-x-auto rounded-sm border border-line bg-bg">
        <table className={cn("diff-table border-collapse", isSplit ? "w-full table-fixed" : "w-max min-w-full")}>
          {isSplit ? (
            // Two equal halves: each side's number and sign columns stay narrow, the text takes the rest.
            <colgroup>
              <col className="w-12" />
              <col className="w-5" />
              <col />
              <col className="w-12" />
              <col className="w-5" />
              <col />
            </colgroup>
          ) : null}
          <caption className="sr-only">{file.path === null ? "Change" : `Change to ${file.path}`}</caption>
          <thead className="sr-only">
            <tr>
              {isSplit ? (
                <>
                  <th scope="col">Old line</th>
                  <th scope="col">Change</th>
                  <th scope="col">Old text</th>
                  <th scope="col">New line</th>
                  <th scope="col">Change</th>
                  <th scope="col">New text</th>
                </>
              ) : (
                <>
                  {noting ? <th scope="col">Note</th> : null}
                  <th scope="col">Old line</th>
                  <th scope="col">New line</th>
                  <th scope="col">Change</th>
                  <th scope="col">Text</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {isSplit
              ? split.map((row, i) =>
                  row.kind === "pair" ? (
                    <tr key={i} data-row="pair">
                      <Half cell={row.left} divider={false} />
                      <Half cell={row.right} divider />
                    </tr>
                  ) : (
                    <Note key={i} row={row} span={span} action={row.kind === "hunk" ? hunkAction(split, i) : undefined} />
                  ),
                )
              : unified.map((row, i) => {
                  if (row.kind !== "line") return <Note key={i} row={row} span={span} action={row.kind === "hunk" ? hunkAction(unified, i) : undefined} />;
                  // A deleted line is on the old side; an added or unchanged one is on the new side.
                  const side = row.tone === "del" ? "old" : "new";
                  const line = side === "old" ? row.old : row.new;
                  const here = noting && line !== undefined ? notes.notes.filter((note) => note.side === side && note.line === line) : [];
                  const adding = `add:${side}:${line}`;
                  return (
                    <Fragment key={i}>
                      <tr data-row={row.tone} className={cn("group", TONE[row.tone])}>
                        {noting ? (
                          <td className="w-6 align-top">
                            {line === undefined ? null : (
                              <button
                                type="button"
                                aria-label={side === "old" ? `Add a note on removed line ${line}` : `Add a note on line ${line}`}
                                title="Add a note"
                                onClick={() => {
                                  setEditing(adding);
                                }}
                                className="mx-0.5 rounded-sm px-1 text-xs leading-normal text-clay-ink opacity-0 outline-offset-2 outline-clay group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2"
                              >
                                +
                              </button>
                            )}
                          </td>
                        ) : null}
                        <td className={NUMBER}>{row.old}</td>
                        <td className={NUMBER}>{row.new}</td>
                        <td className={cn("w-4 select-none text-center align-top", SIGN[row.tone])}>{row.sign.trim()}</td>
                        <td className="whitespace-pre pr-3 align-top text-ink">{row.text}</td>
                      </tr>
                      {here.map((note) =>
                        editing === `edit:${note.id}` ? (
                          <NoteEditor
                            key={note.id}
                            label={`Edit the note on line ${note.line}`}
                            initial={note.text}
                            onSave={(text) => {
                              notes?.onEditNote(note.id, text);
                              setEditing(null);
                            }}
                            onCancel={() => {
                              setEditing(null);
                            }}
                          />
                        ) : (
                          <SavedNote
                            key={note.id}
                            note={note}
                            onEdit={() => {
                              setEditing(`edit:${note.id}`);
                            }}
                            onRemove={() => {
                              notes?.onRemoveNote(note.id);
                            }}
                          />
                        ),
                      )}
                      {noting && line !== undefined && editing === adding ? (
                        <NoteEditor
                          label={`Note on line ${line}`}
                          initial=""
                          onSave={(text) => {
                            if (file.path !== null) notes.onAddNote({ path: file.path, line, side, code: row.text }, text);
                            setEditing(null);
                          }}
                          onCancel={() => {
                            setEditing(null);
                          }}
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
