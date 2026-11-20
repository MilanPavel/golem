import { committedLine, notesFor, UNDO_WAIT, type NotesState } from "@golem/view";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../../ui/button.tsx";
import { useChangedFiles, useCommitInfo, useNotes, useSession } from "../../store/page-context.tsx";
import type { ChangedFile } from "../../store/changes.ts";
import { useDiffMode } from "../diff/index.ts";
import { ChangesViewSwitch, useChangesView } from "./changes-view.tsx";
import { ShellNote } from "./shell-note.tsx";
import { CommitDialog } from "./commit-dialog.tsx";
import { Counts, FileDiffPanel, Row, plural } from "./file-row.tsx";
import { TurnsTab } from "./turns-view.tsx";
import { openFile, useCommitRequest, useRequestedChange } from "./workbench-state.ts";
import { useUndo } from "./undo.tsx";
import { useWorkbenchWidth } from "./workbench-width.ts";

/** From this panel width, in rem, a diff may be shown side by side. Narrower, it is unified. */
export const SPLIT_MIN_WIDTH = 40;

type ChangesViewProps = {
  files: readonly ChangedFile[] | null;
  error: string | null;
  /** The paths of the open rows. */
  open: ReadonlySet<string>;
  /** Opens a closed row and closes an open one. */
  onToggle: (path: string) => void;
  /** The content of an open row: the diff of the file, with its review notes. */
  renderDiff: (file: ChangedFile) => ReactNode;
  /** Shows a file in the Files tab. Without it the rows have no open button. */
  onOpenFile?: (path: string) => void;
  /** With it, each row has an "Undo the changes" button. `disabled` is true while a run is active. */
  undo?: { disabled: boolean; onFile: (path: string) => void };
  /** Beside the totals: the Commit button. */
  footer?: ReactNode;
  /** With it, a row shows how many notes its file has. */
  notes?: { state: NotesState };
};

/** The list of changed files, the open one with its diff, and the totals. It reads nothing itself. */
export function ChangesView({ files, error, open, onToggle, renderDiff, onOpenFile, undo, footer, notes }: ChangesViewProps) {
  if (files === null) {
    return <p className="text-sm text-muted">{error === null ? "Reading the changes." : `Could not read the changes. ${error}`}</p>;
  }
  if (files.length === 0) {
    return <p className="text-sm text-muted">No changes yet. Files golem edits in this session show up here.</p>;
  }
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  return (
    <>
      <ul className="flex flex-col gap-1">
        {files.map((file) => (
          <Row
            key={file.path}
            file={file}
            open={open.has(file.path)}
            onOpenFile={onOpenFile}
            undo={undo === undefined ? undefined : { disabled: undo.disabled, onUndo: () => undo.onFile(file.path) }}
            noteCount={notes === undefined ? 0 : notesFor(notes.state, file.path).length}
            onToggle={() => {
              onToggle(file.path);
            }}
          >
            {renderDiff(file)}
          </Row>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <p className="flex flex-wrap items-center gap-x-2 text-meta text-muted">
          <span>{plural(files.length, "file")}</span>
          <span aria-hidden="true">·</span>
          <Counts added={added} removed={removed} />
        </p>
        {footer}
      </div>
    </>
  );
}

/**
 * The Changes tab: every file the session changed, and a click opens one to its diff. Any number may be
 * open, the first at the start. `openChange` from the chat opens the file it names.
 */
function ByFileTab({ sessionId }: { sessionId: string }) {
  const { files, error } = useChangedFiles(sessionId);
  const [mode, setMode] = useDiffMode();
  const [width] = useWorkbenchWidth();
  const [requested, clearRequest] = useRequestedChange();
  // undefined until the person chooses: then the first file is open.
  const [chosen, setChosen] = useState<ReadonlySet<string> | undefined>(undefined);
  const reveal = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const info = useCommitInfo(sessionId);
  const runActive = useSession(sessionId, (view) => view.chat.busy);
  const undo = useUndo(sessionId);
  const [commitOpen, setCommitOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [commitAsked, clearCommitAsked] = useCommitRequest();
  const commitPaths = info?.repository === true ? info.paths : [];

  // A file that left the list (an undo, say) is not open.
  const open = useMemo(() => {
    const listed = files?.map((file) => file.path) ?? [];
    const wanted: ReadonlySet<string> = chosen ?? new Set(listed.slice(0, 1));
    return new Set(listed.filter((path) => wanted.has(path)));
  }, [files, chosen]);
  const toggle = (path: string): void => {
    const next = new Set(open);
    if (!next.delete(path)) next.add(path);
    setChosen(next);
  };
  const notes = useNotes(sessionId);

  // A new request opens its row in this render; the effect below takes the request off the store.
  const [taken, setTaken] = useState<string | null>(null);
  if (requested !== taken) {
    setTaken(requested);
    if (requested !== null) setChosen(new Set([...open, requested]));
  }
  useEffect(() => {
    if (requested === null) return;
    reveal.current = requested;
    clearRequest();
  }, [requested, clearRequest]);

  // `/commit` asks for the dialog. It opens once git has answered, or says why it cannot.
  const [commitTaken, setCommitTaken] = useState(false);
  if (commitAsked && !commitTaken && info !== null) {
    setCommitTaken(true);
    if (!info.repository) setNotice("This folder is not a git repository.");
    else if (info.paths.length === 0) setNotice("Nothing to commit.");
    else {
      setNotice(null);
      setCommitOpen(true);
    }
  } else if (!commitAsked && commitTaken) {
    setCommitTaken(false);
  }
  useEffect(() => {
    if (commitTaken) clearCommitAsked();
  }, [commitTaken, clearCommitAsked]);

  // The row of a requested file may only appear once the list has it.
  useEffect(() => {
    const path = reveal.current;
    if (path === null || !open.has(path)) return;
    const row = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-path]") ?? []).find((el) => el.dataset["path"] === path);
    if (row === undefined) return;
    reveal.current = null;
    row.scrollIntoView?.({ block: "nearest" });
  }, [open, files]);

  return (
    <div ref={root} className="flex min-w-0 flex-col gap-3">
      <ChangesView
        files={files}
        error={error}
        open={open}
        onToggle={toggle}
        renderDiff={(file) => (
          <FileDiffPanel
            sessionId={sessionId}
            path={file.path}
            mode={mode}
            onMode={setMode}
            canSplit={width >= SPLIT_MIN_WIDTH}
            onHunkAction={(index) => (
              <Button
                size="sm"
                aria-label={`Undo hunk ${index + 1} of ${file.path}`}
                disabled={undo.disabled}
                title={undo.disabled ? UNDO_WAIT : undefined}
                onClick={() => {
                  undo.ask([{ kind: "hunk", path: file.path, hunk: index }]);
                }}
              >
                Undo
              </Button>
            )}
            notes={{
              notes: notesFor(notes.state, file.path),
              onAddNote: (line, text) => {
                notes.add({ ...line, text });
              },
              onEditNote: notes.edit,
              onRemoveNote: notes.remove,
            }}
          />
        )}
        onOpenFile={openFile}
        undo={{
          disabled: undo.disabled,
          onFile: (path) => {
            undo.ask([{ kind: "file", path }]);
          },
        }}
        notes={{ state: notes.state }}
        footer={
          commitPaths.length === 0 ? null : (
            <Button
              size="sm"
              onClick={() => {
                setNotice(null);
                setCommitOpen(true);
              }}
            >
              Commit…
            </Button>
          )
        }
      />
      {notice === null ? null : (
        <p role="status" className="text-meta text-ink">
          {notice}
        </p>
      )}
      {undo.dialogs}
      <CommitDialog
        sessionId={sessionId}
        open={commitOpen}
        onOpenChange={setCommitOpen}
        branch={info?.branch ?? null}
        paths={commitPaths}
        runActive={runActive}
        onCommitted={(sha) => setNotice(committedLine(sha))}
      />
    </div>
  );
}

/** The Changes tab: the files of the session, or the same changes by turn. The choice is kept. */
export function ChangesTab({ sessionId }: { sessionId: string }) {
  const [view, setView] = useChangesView();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ChangesViewSwitch view={view} onChange={setView} />
      <ShellNote sessionId={sessionId} />
      {view === "turn" ? <TurnsTab sessionId={sessionId} /> : <ByFileTab sessionId={sessionId} />}
    </div>
  );
}
