import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { CheckIcon, ChevronDownIcon, FolderIcon, PlusIcon, SearchIcon } from "../../ui/icons.tsx";
import { folderName } from "../sessions/folder.ts";
import { resolveTyped } from "./folder-browser.tsx";

/** A folder in the menu, with its git branch when it has one. */
export type FolderRow = { path: string; branch: string | null };

/** The other checkouts of the repo the folder is in. Agent worktrees fold into one row. */
export type WorktreeRows = { repo: string; rows: FolderRow[]; agents: FolderRow[] };

export type FolderMenuBodyProps = {
  /** The folder the next session runs in, or null for none. */
  folder: string | null;
  /** The branch of `folder`, from `git.info`. */
  branch: string | null;
  /** The folders known from earlier sessions, newest first. */
  recent: readonly FolderRow[];
  /** The repo's other worktrees; null when the folder is not in a repo with more than one. */
  worktrees: WorktreeRows | null;
  /** The home folder, for `~`. Null until it is known. */
  home: string | null;
  /** The pick: a path, or null for no folder. */
  onPick: (path: string | null) => void;
  /** `Choose folder…`, the macOS dialog. Without it the dialog is not offered and `Browse…` takes its place. */
  onChoose?: () => void;
  /** The in-app browser. Without it the browser is not offered. */
  onBrowse?: () => void;
  /** The macOS dialog is open: the menu waits for it. */
  waiting?: boolean;
  /** Stop waiting for the dialog. The dialog itself stays on the Mac. */
  onCancelWait?: () => void;
  /** Why the dialog could not open. */
  error?: string | null;
  /** Where focus starts. The popover sets it by hand, so it is off in the gallery. */
  autoFocus?: boolean;
};

/** The parent folder of a path, shown small under its name: `~/code` when under home. */
function parentOf(path: string, home: string | null): string {
  const cut = path.lastIndexOf("/");
  const parent = cut <= 0 ? "/" : path.slice(0, cut);
  if (home !== null && home !== "/" && (parent === home || parent.startsWith(`${home}/`))) return `~${parent.slice(home.length)}`;
  return parent;
}

type Option = {
  id: string;
  run: () => void;
  node: ReactNode;
  /** The folder the session would run in now. */
  current?: boolean;
};

type Section = { key: string; label: string; options: Option[] };

const ROW = "flex w-full cursor-default items-center gap-2.5 rounded-md border-0 bg-transparent px-3 py-1.5 text-left text-sm text-ink aria-selected:bg-sunken";

function BranchTag({ branch }: { branch: string | null }) {
  if (branch === null) return null;
  return <Code className="max-w-32 shrink-0 truncate rounded-full border border-line px-1.5 text-meta text-muted">{branch}</Code>;
}

function RowText({ title, sub }: { title: string; sub?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate font-medium">{title}</span>
      {sub === undefined ? null : <small className="truncate text-meta text-muted">{sub}</small>}
    </span>
  );
}

/**
 * The folder menu of the empty screen: a field that filters or takes a typed path, the current
 * folder, recent folders, this repo's worktrees, and the ways to choose one that is not listed.
 */
export function FolderMenuBody({ folder, branch, recent, worktrees, home, onPick, onChoose, onBrowse, waiting = false, onCancelWait, error = null, autoFocus = true }: FolderMenuBodyProps) {
  const base = useId();
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);

  const text = query.trim();
  const needle = text.toLowerCase();
  const typing = text.startsWith("/") || text === "~" || text.startsWith("~/");
  const typed = typing ? resolveTyped(text, home) : null;
  const matches = (path: string) => needle === "" || path.toLowerCase().includes(needle);
  const optionId = (key: string) => `${base}-${key}`;

  function folderOption(key: string, row: FolderRow, current: boolean): Option {
    return {
      id: key,
      current,
      run: () => onPick(row.path),
      node: (
        <>
          <FolderIcon className="size-4 shrink-0 text-muted" />
          <RowText title={folderName(row.path)} sub={parentOf(row.path, home)} />
          <BranchTag branch={row.branch} />
          {current ? <CheckIcon className="size-4 shrink-0 text-clay-ink" /> : null}
        </>
      ),
    };
  }

  function noFolderOption(id: string, current: boolean): Option {
    return {
      id,
      current,
      run: () => onPick(null),
      node: (
        <>
          <FolderIcon className="size-4 shrink-0 text-muted" />
          <RowText title="No folder" />
          {current ? <CheckIcon className="size-4 shrink-0 text-clay-ink" /> : null}
        </>
      ),
    };
  }

  const sections: Section[] = [];
  if (typed !== null) {
    sections.push({
      key: "path",
      label: "Path",
      options: [
        {
          id: "use",
          run: () => onPick(typed),
          node: (
            <>
              <PlusIcon className="size-4 shrink-0 text-muted" />
              <RowText title={`Use ${text}`} sub="golem checks it when the session starts" />
              <kbd className="text-meta text-faint">↵</kbd>
            </>
          ),
        },
      ],
    });
  } else if (!typing) {
    if (needle === "") {
      sections.push({ key: "current", label: "Current", options: [folder === null ? noFolderOption("current", true) : folderOption("current", { path: folder, branch }, true)] });
    }
    const others = recent.filter((row) => row.path !== folder && matches(row.path));
    const none = folder !== null && matches("no folder");
    const recentOptions = others.map((row, index) => folderOption(`recent-${index}`, row, false));
    if (none) recentOptions.push(noFolderOption("none", false));
    if (recentOptions.length > 0) sections.push({ key: "recent", label: "Recent", options: recentOptions });
    if (worktrees !== null) {
      const rows = worktrees.rows.filter((row) => row.path !== folder && matches(row.path));
      const agents = worktrees.agents.filter((row) => row.path !== folder && matches(row.path));
      const options = rows.map((row, index) => folderOption(`worktree-${index}`, row, false));
      if (agents.length > 0) {
        options.push({
          id: "agents",
          run: () => setShowAgents((open) => !open),
          node: (
            <>
              <ChevronDownIcon className={cn("size-4 shrink-0 text-muted", showAgents ? "" : "-rotate-90")} />
              <RowText title={`${agents.length} agent ${agents.length === 1 ? "worktree" : "worktrees"}`} sub=".claude/worktrees" />
              <span className="sr-only">{showAgents ? "shown" : "folded"}</span>
            </>
          ),
        });
        if (showAgents) agents.forEach((row, index) => options.push(folderOption(`agent-${index}`, row, false)));
      }
      if (options.length > 0) sections.push({ key: "worktrees", label: `Worktrees of ${worktrees.repo}`, options });
    }
  }

  const footer: Option[] = [];
  if (onChoose !== undefined) {
    footer.push({
      id: "choose",
      run: onChoose,
      node: (
        <>
          <PlusIcon className="size-4 shrink-0 text-muted" />
          <RowText title="Choose folder…" sub="the macOS dialog, on this Mac" />
        </>
      ),
    });
  }
  if (onBrowse !== undefined) {
    footer.push({
      id: "browse",
      run: onBrowse,
      node: (
        <>
          <FolderIcon className="size-4 shrink-0 text-muted" />
          <RowText title={onChoose === undefined ? "Browse…" : "Browse in golem"} />
        </>
      ),
    });
  }

  const all = [...sections.flatMap((section) => section.options), ...footer];
  const active = all.find((option) => option.id === activeKey) ?? all[0] ?? null;
  const nothing = !typing && needle !== "" && sections.length === 0;

  function move(by: number): void {
    if (all.length === 0) return;
    const at = active === null ? 0 : all.indexOf(active);
    setActiveKey(all[Math.min(Math.max(at + by, 0), all.length - 1)]!.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter") active?.run();
    else return;
    event.preventDefault();
  }

  function renderOption(option: Option): ReactNode {
    return (
      <button
        type="button"
        key={option.id}
        id={optionId(option.id)}
        role="option"
        tabIndex={-1}
        aria-selected={option === active}
        aria-current={option.current === true ? "true" : undefined}
        // Focus stays in the field, so a press must not take it.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => setActiveKey(option.id)}
        onClick={option.run}
        className={ROW}
      >
        {option.node}
      </button>
    );
  }

  if (waiting) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
        <p role="status" className="text-sm text-muted">
          Waiting for the folder dialog on your Mac…
        </p>
        <Button size="sm" onClick={onCancelWait}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <SearchIcon className="size-4 shrink-0 text-muted" />
        <input
          role="combobox"
          aria-label="Filter, or type a path"
          aria-expanded="true"
          aria-controls={`${base}-list`}
          aria-activedescendant={active === null ? undefined : optionId(active.id)}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder="Filter, or type a path: ~/code/app"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
        />
        <kbd className="text-meta text-faint">esc</kbd>
      </div>
      {error === null ? null : (
        <p role="alert" className="px-3 pt-2 text-xs text-deny">
          {error}
        </p>
      )}
      <div id={`${base}-list`} role="listbox" aria-label="Folders" className="flex max-h-96 min-h-0 flex-1 flex-col overflow-y-auto p-1">
        {sections.map((section) => (
          <div key={section.key} role="group" aria-label={section.label} className="flex flex-col">
            <div aria-hidden="true" className="px-3 pt-2 pb-1 text-meta text-faint">
              {section.label}
            </div>
            {section.options.map(renderOption)}
          </div>
        ))}
        {nothing ? <p className="px-3 py-3 text-sm text-muted">No folder matches “{text}”. Type a path starting with / or ~</p> : null}
        {footer.length > 0 ? (
          <div role="group" aria-label="More ways to choose" className="mt-1 flex flex-col border-t border-line pt-1">
            {footer.map(renderOption)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
