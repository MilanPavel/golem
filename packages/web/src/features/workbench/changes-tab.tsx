import { committedLine, notesFor, type NotesState } from "@golem/view";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Badge } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/button.tsx";
import { useChangedFiles, useCommitInfo, useFileDiff, useNotes, useSession } from "../../store/page-context.tsx";
import type { ChangedFile, FileDiff } from "../../store/changes.ts";
import { DiffModeSwitch, DiffView, useDiffMode, type DiffMode, type NoteLine } from "../diff/index.ts";
import { CommitDialog } from "./commit-dialog.tsx";
import { useCommitRequest, useRequestedChange } from "./workbench-state.ts";
import { useWorkbenchWidth } from "./workbench-width.ts";

/** From this panel width, in rem, a diff may be shown side by side. Narrower, it is unified. */
export const SPLIT_MIN_WIDTH = 40;

const SMALL = "px-1.5 py-0 text-xs";

/** The folder part of a path with its slash, and the file name. */
function splitPath(path: string): [string, string] {
  const slash = path.lastIndexOf("/");
  return [path.slice(0, slash + 1), path.slice(slash + 1)];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <>
      <span className="text-allow">
        +{added}
        <span className="sr-only"> lines added</span>
      </span>
      <span className="text-deny">
        −{removed}
        <span className="sr-only"> lines removed</span>
      </span>
    </>
  );
}

function Row({
  file,
  open,
  onToggle,
  panel,
  noteCount = 0,
  children,
}: {
  file: ChangedFile;
  noteCount?: number;
  open: boolean;
  onToggle: () => void;
  panel: string;
  children: ReactNode;
}) {
  const [folder, name] = splitPath(file.path);
  return (
    <li data-path={file.path} className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        title={file.path}
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left font-mono text-xs outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2"
      >
        <ChevronDownIcon aria-hidden="true" className={cn("size-3.5 flex-none text-muted", !open && "-rotate-90")} />
        <span className="flex min-w-0 flex-1 items-baseline">
          {folder === "" ? null : <span className="min-w-0 truncate text-muted">{folder}</span>}
          <span className="flex-none text-ink">{name}</span>
        </span>
        {file.status === "created" ? <Badge tone="allow" className={SMALL}>new</Badge> : null}
        {file.status === "deleted" ? <Badge tone="deny" className={SMALL}>deleted</Badge> : null}
        {file.stale ? <Badge tone="wait" className={SMALL}>changed on disk</Badge> : null}
        {noteCount > 0 ? <Badge tone="wait" className={SMALL}>{plural(noteCount, "note")}</Badge> : null}
        <Counts added={file.added} removed={file.removed} />
      </button>
      {open ? (
        <div id={panel} className="min-w-0">
          {children}
        </div>
      ) : null}
    </li>
  );
}

type ChangesViewProps = {
  files: readonly ChangedFile[] | null;
  error: string | null;
  /** The path of the open row, or null for none. */
  open: string | null;
  onOpen: (path: string | null) => void;
  diff: FileDiff;
  mode: DiffMode;
  onMode: (mode: DiffMode) => void;
  /** Whether the panel has room for the split layout. */
  canSplit: boolean;
  /** Beside the totals: the Commit button. */
  footer?: ReactNode;
  /** With it, a diff in the unified layout takes review notes. */
  notes?: {
    state: NotesState;
    onAdd: (line: NoteLine, text: string) => void;
    onEdit: (id: string, text: string) => void;
    onRemove: (id: string) => void;
  };
};

/** The list of changed files, the open one with its diff, and the totals. It reads nothing itself. */
export function ChangesView({ files, error, open, onOpen, diff, mode, onMode, canSplit, footer, notes }: ChangesViewProps) {
  const panel = useId();
  if (files === null) {
    return <p className="text-sm text-muted">{error === null ? "Reading the changes." : `Could not read the changes. ${error}`}</p>;
  }
  if (files.length === 0) {
    return <p className="text-sm text-muted">No changes yet. Files golem edits in this session show up here.</p>;
  }
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const shown: DiffMode = canSplit ? mode : "unified";
  return (
    <>
      <ul className="flex flex-col gap-1">
        {files.map((file) => (
          <Row
            key={file.path}
            file={file}
            open={file.path === open}
            panel={panel}
            noteCount={notes === undefined ? 0 : notesFor(notes.state, file.path).length}
            onToggle={() => {
              onOpen(file.path === open ? null : file.path);
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <DiffModeSwitch mode={shown} onChange={onMode} disabled={!canSplit} />
            </div>
            {diff.error !== null ? (
              <p className="text-sm text-muted">{`Could not read the diff. ${diff.error}`}</p>
            ) : diff.diff === null ? (
              <p className="text-sm text-muted">Reading the diff.</p>
            ) : (
              <>
                <DiffView
                  diff={diff.diff}
                  mode={shown}
                  {...(notes === undefined
                    ? {}
                    : {
                        notes: {
                          notes: notesFor(notes.state, file.path),
                          onAddNote: notes.onAdd,
                          onEditNote: notes.onEdit,
                          onRemoveNote: notes.onRemove,
                        },
                      })}
                />
                {diff.truncated ? <p className="mt-2 text-xs text-muted">This diff is cut. Open the file to see all of it.</p> : null}
              </>
            )}
          </Row>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <p className="flex flex-wrap items-center gap-x-2 font-mono text-xs text-muted">
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
 * The Changes tab: every file the session changed, and a click opens one to its diff. One file is
 * open at a time, the first at the start. `openChange` from the chat opens the file it names.
 */
export function ChangesTab({ sessionId }: { sessionId: string }) {
  const { files, error } = useChangedFiles(sessionId);
  const [mode, setMode] = useDiffMode();
  const [width] = useWorkbenchWidth();
  const [requested, clearRequest] = useRequestedChange();
  // undefined until the person chooses: then the first file is open.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const reveal = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const info = useCommitInfo(sessionId);
  const runActive = useSession(sessionId, (view) => view.chat.busy);
  const [commitOpen, setCommitOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [commitAsked, clearCommitAsked] = useCommitRequest();
  const commitPaths = info?.repository === true ? info.paths : [];

  const paths = files?.map((file) => file.path) ?? null;
  const wanted = chosen === undefined ? (paths?.[0] ?? null) : chosen;
  // A file that left the list (an undo, say) is not open.
  const open = paths !== null && wanted !== null && paths.includes(wanted) ? wanted : null;
  const diff = useFileDiff(sessionId, open);
  const notes = useNotes(sessionId);

  // A new request opens its row in this render; the effect below takes the request off the store.
  const [taken, setTaken] = useState<string | null>(null);
  if (requested !== taken) {
    setTaken(requested);
    if (requested !== null) setChosen(requested);
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
    if (path === null || open !== path) return;
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
        onOpen={setChosen}
        diff={diff}
        mode={mode}
        onMode={setMode}
        canSplit={width >= SPLIT_MIN_WIDTH}
        notes={{
          state: notes.state,
          onAdd: (line, text) => {
            notes.add({ ...line, text });
          },
          onEdit: notes.edit,
          onRemove: notes.remove,
        }}
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
        <p role="status" className="font-mono text-xs text-ink">
          {notice}
        </p>
      )}
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
