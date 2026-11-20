import { UNDO_WAIT } from "@golem/view";
import { useId, type ComponentProps, type ReactNode } from "react";
import { Badge } from "../../ui/badge.tsx";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { ChevronDownIcon, OpenIcon, UndoIcon } from "../../ui/icons.tsx";
import { useChangeDiff, useFileDiff } from "../../store/page-context.tsx";
import type { ChangedFile, FileDiff } from "../../store/changes.ts";
import { DiffModeSwitch, DiffView, type DiffMode } from "../diff/index.ts";
import { Code } from "../../ui/code.tsx";

const SMALL = "px-1.5 py-0 text-xs";

/** The folder part of a path with its slash, and the file name. */
function splitPath(path: string): [string, string] {
  const slash = path.lastIndexOf("/");
  return [path.slice(0, slash + 1), path.slice(slash + 1)];
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function Counts({ added, removed }: { added: number; removed: number }) {
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

export function Row({
  file,
  open,
  onToggle,
  onOpenFile,
  noteCount = 0,
  undo,
  children,
}: {
  file: ChangedFile;
  noteCount?: number;
  open: boolean;
  onToggle: () => void;
  /** Shows the file in the Files tab. Without it the row has no open button. */
  onOpenFile?: ((path: string) => void) | undefined;
  /** With it, the row has an "Undo the changes" button. `disabled` is true while a run is active. */
  undo?: { disabled: boolean; onUndo: () => void } | undefined;
  children: ReactNode;
}) {
  const [folder, name] = splitPath(file.path);
  const panel = useId();
  return (
    <li data-path={file.path} className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        title={file.path}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left text-meta outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2"
      >
        <ChevronDownIcon aria-hidden="true" className={cn("size-3.5 flex-none text-muted", !open && "-rotate-90")} />
        <span className="flex min-w-0 flex-1 items-baseline">
          {folder === "" ? null : <Code tone="muted" className="min-w-0 truncate">{folder}</Code>}
          <Code className="flex-none">{name}</Code>
        </span>
        {file.status === "created" ? <Badge tone="allow" className={SMALL}>new</Badge> : null}
        {file.status === "deleted" ? <Badge tone="deny" className={SMALL}>deleted</Badge> : null}
        {file.stale ? <Badge tone="wait" className={SMALL}>changed on disk</Badge> : null}
        {noteCount > 0 ? <Badge tone="wait" className={SMALL}>{plural(noteCount, "note")}</Badge> : null}
        <Counts added={file.added} removed={file.removed} />
      </button>
      {undo === undefined ? null : (
        <IconButton
          label={`Undo the changes to ${file.path}`}
          disabled={undo.disabled}
          title={undo.disabled ? UNDO_WAIT : undefined}
          onClick={undo.onUndo}
        >
          <UndoIcon />
        </IconButton>
      )}
      {onOpenFile === undefined || file.status === "deleted" ? null : (
        <IconButton
          label={`Open ${name} in Files`}
          onClick={() => {
            onOpenFile(file.path);
          }}
        >
          <OpenIcon />
        </IconButton>
      )}
      </div>
      {open ? (
        <div id={panel} className="min-w-0">
          {children}
        </div>
      ) : null}
    </li>
  );
}

/** The layout switch and the diff of the open row, or a line saying it is being read or failed. With `notes`, the diff takes review notes. */
export function DiffPanel({
  diff,
  mode,
  onMode,
  canSplit,
  notes,
  onHunkAction,
}: {
  diff: FileDiff;
  mode: DiffMode;
  onMode: (mode: DiffMode) => void;
  canSplit: boolean;
  notes?: NonNullable<ComponentProps<typeof DiffView>["notes"]>;
  /** Draws a control in each hunk header. */
  onHunkAction?: (index: number) => ReactNode;
}) {
  const shown: DiffMode = canSplit ? mode : "unified";
  return (
    <>
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
            {...(notes === undefined ? {} : { notes })}
            {...(onHunkAction === undefined ? {} : { onHunkAction })}
          />
          {diff.truncated ? <p className="mt-2 text-xs text-muted">This diff is cut. Open the file to see all of it.</p> : null}
        </>
      )}
    </>
  );
}

type PanelProps = Omit<ComponentProps<typeof DiffPanel>, "diff">;

/** The diff panel of one file's current change. Only an open row mounts it, so a closed row reads nothing. */
export function FileDiffPanel({ sessionId, path, ...rest }: PanelProps & { sessionId: string; path: string }) {
  return <DiffPanel diff={useFileDiff(sessionId, path)} {...rest} />;
}

/** The diff panel of one change, as one turn made it. */
export function ChangeDiffPanel({ sessionId, changeId, ...rest }: PanelProps & { sessionId: string; changeId: string | null }) {
  return <DiffPanel diff={useChangeDiff(sessionId, changeId)} {...rest} />;
}
