import { useRef, useState, type ReactNode } from "react";
import { FolderIcon } from "../../ui/icons.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { FOLDER_CHIP, FolderChipName } from "../composer/index.ts";
import { folderName } from "../sessions/folder.ts";
import type { GitInfoResult } from "../../store/dirs.ts";
import type { FolderBrowserProps } from "./folder-browser.tsx";
import { FolderMenuBody, type FolderRow, type WorktreeRows } from "./folder-menu.tsx";

export { parseTypedPath } from "./folder-browser.tsx";

export type FolderChipProps = {
  folder: string | null;
  /** The folders to offer, newest first. */
  folders: readonly string[];
  onChange: (folder: string | null) => void;
  /** What git says about `folder`: its branch and the repo's worktrees. */
  info?: GitInfoResult | null;
  /** The branch of each known folder that has one. */
  branches?: Readonly<Record<string, string | null>>;
  /** The home folder, for `~`. */
  home?: string | null;
  /** The folder browser, for `Browse…` where the macOS dialog is not offered. Without it the item is not offered. */
  browser?: (props: FolderBrowserProps) => ReactNode;
  /** The macOS folder dialog: resolves with the folder, or null when it was cancelled. Without it the dialog is not offered. */
  onChoose?: (start: string | null) => Promise<string | null>;
  /** Opens a folder in Finder: resolves when it is open. Without it the item is not offered. */
  onReveal?: (folder: string) => Promise<void>;
  /** Opens at once, as it does when a session sent the person here to pick another folder. */
  defaultOpen?: boolean;
};

/** The repo's other checkouts for the menu, or null when there is only one. */
export function worktreeRows(info: GitInfoResult | null | undefined, branches: Readonly<Record<string, string | null>> = {}): WorktreeRows | null {
  if (!info?.repository || info.worktrees.length < 2) return null;
  const row = (path: string, branch: string | null | undefined): FolderRow => ({ path, branch: branch ?? branches[path] ?? null });
  return {
    repo: folderName(info.root ?? info.worktrees[0]?.path ?? null),
    rows: info.worktrees.filter((tree) => !tree.agent).map((tree) => row(tree.path, tree.branch)),
    agents: info.worktrees.filter((tree) => tree.agent).map((tree) => row(tree.path, tree.branch)),
  };
}

/** Renders the injected browser as a component of its own, so the chip's refs stay out of its render. */
function BrowserSlot({ render, props }: { render: (props: FolderBrowserProps) => ReactNode; props: FolderBrowserProps }) {
  return <>{render(props)}</>;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : "The folder dialog did not open.";
}

/** The folder the next session will run in, as a chip in the composer's row, with a menu to change it. */
export function FolderChip({ folder, folders, onChange, info = null, branches = {}, home = null, browser, onChoose, onReveal, defaultOpen = false }: FolderChipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<"menu" | "browse">("menu");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);

  function change(next: boolean): void {
    setOpen(next);
    if (!next) {
      // Closing stops waiting for the dialog; its answer is dropped.
      token.current += 1;
      setView("menu");
      setWaiting(false);
      setError(null);
    }
  }

  function pick(path: string | null): void {
    onChange(path);
    change(false);
  }

  function choose(): void {
    if (onChoose === undefined) return;
    const mine = ++token.current;
    setError(null);
    setWaiting(true);
    onChoose(folder).then(
      (path) => {
        if (token.current !== mine) return;
        setWaiting(false);
        if (path !== null) pick(path);
      },
      (failure: unknown) => {
        if (token.current !== mine) return;
        setWaiting(false);
        setError(errorText(failure));
      },
    );
  }

  function reveal(): void {
    if (onReveal === undefined || folder === null) return;
    setError(null);
    onReveal(folder).then(
      () => change(false),
      (failure: unknown) => setError(errorText(failure)),
    );
  }

  const here = folder === null ? null : (info?.branch ?? branches[folder] ?? null);
  const recent: FolderRow[] = folders.map((path) => ({ path, branch: path === folder ? here : (branches[path] ?? null) }));

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <button type="button" title={folder ?? undefined} aria-label={`Folder: ${folderName(folder)}`} aria-haspopup="dialog" className={FOLDER_CHIP}>
          <FolderIcon />
          <FolderChipName folder={folder} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={12}
        aria-label={view === "browse" ? "Choose a folder" : "Folder"}
        className="flex max-h-(--radix-popover-content-available-height) w-96 max-w-(--radix-popover-content-available-width) flex-col overflow-hidden p-0"
      >
        {view === "browse" && browser !== undefined ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <BrowserSlot render={browser} props={{ initialPath: folder, autoFocus: true, onPick: pick, onCancel: () => setView("menu") }} />
          </div>
        ) : (
          <FolderMenuBody
            folder={folder}
            branch={here}
            recent={recent}
            worktrees={worktreeRows(info, branches)}
            home={home}
            onPick={pick}
            onChoose={onChoose === undefined ? undefined : choose}
            onReveal={onReveal === undefined ? undefined : reveal}
            onBrowse={browser === undefined ? undefined : () => setView("browse")}
            waiting={waiting}
            onCancelWait={() => {
              token.current += 1;
              setWaiting(false);
            }}
            error={error}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
