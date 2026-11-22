import { useState } from "react";
import { revealErrorText } from "../../store/errors.ts";
import { useFolderDialog, useFolderMenuRequest, useGitInfo, useNavigate, useNewSessionFolder, useSession, useSessionList, usePageActions } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { writeClipboard } from "../../ui/clipboard.ts";
import { CopyIcon, FolderIcon, PlusIcon } from "../../ui/icons.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { folderName } from "../sessions/folder.ts";
import { BAR_CHIP, ICON_UNDER_400 } from "./composer-bar.ts";

/** The look of the folder chip: it shrinks before the model does, and under 400 px it is the icon alone. */
export const FOLDER_CHIP = cn(BAR_CHIP, "max-w-44 shrink-2");

/** The folder's name in the chip. Under 400 px it stays for screen readers only. */
export function FolderChipName({ folder }: { folder: string | null }) {
  return <span className={cn("min-w-0 truncate", ICON_UNDER_400)}>{folderName(folder)}</span>;
}

/** The folder of a session in the composer's row. It is fixed for the session, so it has no menu. */
export function FolderBarBadge({ folder }: { folder: string | null }) {
  return (
    <span title={folder ?? undefined} className={cn(FOLDER_CHIP, "cursor-default hover:bg-transparent hover:text-muted")}>
      <FolderIcon />
      <FolderChipName folder={folder} />
    </span>
  );
}

/** The words of an open session's folder menu. */
export const SESSION_KEEPS_FOLDER = "A session keeps its folder. To work elsewhere, start a new one.";

const MENU_ROW = "flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-3 py-1.5 text-left text-sm text-ink -outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2";

export type SessionFolderMenuBodyProps = {
  folder: string;
  /** The branch of the folder, when it is in a repo on one. */
  branch: string | null;
  onCopy: () => void;
  /** `Open in Finder`. Without it the item is not offered. */
  onReveal?: () => void;
  /** Why the folder did not open in Finder. */
  error?: string | null;
  onNewHere: () => void;
  onNewElsewhere: () => void;
};

/**
 * The menu of an open session's folder. It is read only: a session keeps its folder, so the ways
 * out are a new session here or in another folder.
 */
export function SessionFolderMenuBody({ folder, branch, onCopy, onReveal, error = null, onNewHere, onNewElsewhere }: SessionFolderMenuBodyProps) {
  const cut = folder.lastIndexOf("/");
  return (
    <div className="flex flex-col py-1">
      <div className="flex items-center gap-2.5 px-3 pt-2 pb-1">
        <FolderIcon className="size-4 shrink-0 text-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-ink">{folderName(folder)}</span>
          <small className="truncate text-meta text-muted">{cut <= 0 ? "/" : folder.slice(0, cut)}</small>
        </span>
        {branch === null ? null : (
          <Code className="max-w-32 shrink-0 truncate rounded-full border border-line px-1.5 text-meta text-muted">{branch}</Code>
        )}
      </div>
      <p className="px-3 pb-2 text-meta text-muted">{SESSION_KEEPS_FOLDER}</p>
      {error === null ? null : (
        <p role="alert" className="px-3 pb-2 text-xs text-deny">
          {error}
        </p>
      )}
      <div className="flex flex-col border-t border-line px-1 pt-1">
        <button type="button" className={MENU_ROW} onClick={onCopy}>
          <CopyIcon className="size-4 shrink-0 text-muted" />
          Copy path
        </button>
        {onReveal === undefined ? null : (
          <button type="button" className={MENU_ROW} onClick={onReveal}>
            <FolderIcon className="size-4 shrink-0 text-muted" />
            Open in Finder
          </button>
        )}
        <button type="button" className={MENU_ROW} onClick={onNewHere}>
          <PlusIcon className="size-4 shrink-0 text-muted" />
          New session in this folder
        </button>
        <button type="button" className={MENU_ROW} onClick={onNewElsewhere}>
          <FolderIcon className="size-4 shrink-0 text-muted" />
          New session in another folder…
        </button>
      </div>
    </div>
  );
}

/** The folder chip of an open session: its folder, with the read-only menu. */
export function SessionFolderChip({ folder, branch, onReveal, onNewHere, onNewElsewhere }: Omit<SessionFolderMenuBodyProps, "onCopy" | "error" | "onReveal"> & { onReveal?: (folder: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" title={folder} aria-label={`Folder: ${folderName(folder)}`} aria-haspopup="dialog" className={FOLDER_CHIP}>
          <FolderIcon />
          <FolderChipName folder={folder} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" collisionPadding={12} aria-label="This session's folder" className="max-h-(--radix-popover-content-available-height) w-80 max-w-(--radix-popover-content-available-width) overflow-y-auto p-0">
        <SessionFolderMenuBody
          folder={folder}
          branch={branch}
          onCopy={() => {
            void writeClipboard(folder).catch(() => undefined);
            setOpen(false);
          }}
          error={error}
          onReveal={
            onReveal === undefined
              ? undefined
              : () => {
                  setError(null);
                  onReveal(folder).then(
                    () => setOpen(false),
                    (failure: unknown) => setError(failure instanceof Error ? failure.message : "The folder did not open in Finder."),
                  );
                }
          }
          onNewHere={() => {
            setOpen(false);
            onNewHere();
          }}
          onNewElsewhere={() => {
            setOpen(false);
            onNewElsewhere();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

const selectCwd = (view: SessionView) => view.cwd;
const selectStatus = (view: SessionView) => view.status;

/** The badge of a session, or nothing while its folder is not known. */
export function SessionFolder({ sessionId }: { sessionId: string }) {
  const cwd = useSession(sessionId, selectCwd);
  const status = useSession(sessionId, selectStatus);
  const summary = useSessionList().find((session) => session.session_id === sessionId);
  const folder = summary ? (summary.cwd ?? null) : status === "ready" ? cwd : undefined;
  if (folder === undefined) return null;
  return folder === null ? <FolderBarBadge folder={null} /> : <OpenSessionFolder folder={folder} />;
}

function OpenSessionFolder({ folder }: { folder: string }) {
  const info = useGitInfo(folder);
  const [, setFolder] = useNewSessionFolder();
  const { ask } = useFolderMenuRequest();
  const navigate = useNavigate();
  const local = useFolderDialog();
  const actions = usePageActions();
  return (
    <SessionFolderChip
      folder={folder}
      onReveal={
        local
          ? async (path) => {
              try {
                await actions.reveal(path);
              } catch (error) {
                throw new Error(revealErrorText(error));
              }
            }
          : undefined
      }
      branch={info.data?.branch ?? null}
      onNewHere={() => {
        setFolder(folder);
        navigate("/");
      }}
      onNewElsewhere={() => {
        ask();
        navigate("/");
      }}
    />
  );
}
