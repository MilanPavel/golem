import { useState, type KeyboardEvent } from "react";
import {
  useGitBranches,
  useGitInfo,
  useNavigate,
  useNewSessionBranch,
  useNewSessionFolder,
  useSession,
  useSessionList,
} from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { BranchIcon, CheckIcon, PlusIcon, SearchIcon } from "../../ui/icons.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover.tsx";
import { folderName } from "../sessions/folder.ts";
import { BAR_CHIP, ICON_UNDER_500 } from "./composer-bar.ts";

const filesText = (count: number) => `${count} changed ${count === 1 ? "file" : "files"}`;

/** The look of the chip: it leaves the row under 330 px, where the folder menu shows the branch. */
const BRANCH_CHIP = cn(BAR_CHIP, "max-w-44 shrink-2 @max-row-330/comp:hidden");

export type BranchChipViewProps = {
  /** `home` marks a branch for the next session. `session` shows the live one and starts a new session on another. */
  mode: "home" | "session";
  folder: string | null;
  /** The branch the chip shows: the one marked on home, else the folder's own. */
  shown: string;
  /** The branch the folder is on now. */
  current: string | null;
  /** How many files git sees changed in the folder. */
  changed: number;
  /** The branch changed under the session in this turn. */
  amber?: boolean;
  /** The local branches, newest first. Null while they are read. */
  branches: readonly string[] | null;
  /** Titles of the other open sessions in this folder. */
  sharedWith?: readonly string[];
  onPick: (branch: string) => void;
  onCreate: (branch: string) => void;
};

function sharedNote(titles: readonly string[], folder: string | null): string {
  const who = titles.length === 1 ? (titles[0] as string) : `${titles.length} sessions`;
  return `${who} also ${titles.length === 1 ? "works" : "work"} in ${folderName(folder)}. If you switch, ${titles.length === 1 ? "it sees" : "they see"} the new branch too; golem tells ${titles.length === 1 ? "its" : "their"} model.`;
}

/** The branch of the folder, as a chip in the composer's row with a menu of branches. */
export function BranchChipView({ mode, folder, shown, current, changed, amber = false, branches, sharedWith = [], onPick, onCreate }: BranchChipViewProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim();
  const list = (branches ?? []).filter((name) => q === "" || name.toLowerCase().includes(q.toLowerCase()));
  const canCreate = q !== "" && !(branches ?? []).includes(q);
  const session = mode === "session";

  function change(next: boolean): void {
    setOpen(next);
    if (!next) setQuery("");
  }
  function pick(name: string): void {
    change(false);
    onPick(name);
  }
  function create(name: string): void {
    change(false);
    onCreate(name);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const first = list[0];
    if (first !== undefined) pick(q === "" ? first : (list.find((name) => name === q) ?? first));
    else if (canCreate) create(q);
  }

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Branch: ${shown}`}
          title={`Branch: ${shown}${changed > 0 ? `, ${filesText(changed)}` : ""}`}
          data-amber={amber ? "true" : undefined}
          className={cn(BRANCH_CHIP, amber && "text-wait")}
        >
          <BranchIcon />
          <Code className={cn("min-w-0 truncate", ICON_UNDER_500)}>{shown}</Code>
          {changed > 0 ? (
            <span className="shrink-0 text-wait" aria-label={filesText(changed)}>
              ±{changed}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Branches"
        className="flex max-h-96 w-80 flex-col p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector("input")?.focus();
        }}
      >
        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto p-1">
          {session ? (
            <p className="px-2 pt-1.5 pb-1 text-meta text-muted">
              This session stays on <Code className="font-medium">{current ?? shown}</Code>. Pick a branch to start a new session on it.
            </p>
          ) : null}
          {changed > 0 ? (
            <p className="mx-1 rounded-sm bg-wait-soft px-2 py-1.5 text-meta text-ink">
              <b className="font-medium">{filesText(changed)}</b> in {folderName(folder)}. They go along to the new branch.
            </p>
          ) : null}
          {sharedWith.length > 0 ? <p className="mx-1 rounded-sm bg-sunken px-2 py-1.5 text-meta text-muted">{sharedNote(sharedWith, folder)}</p> : null}
          <div className="flex items-baseline justify-between px-2 pt-1 text-meta text-faint">
            <span>Branches</span>
            {branches === null ? null : <span>{branches.length} local</span>}
          </div>
          <ul className="flex flex-col gap-0.5">
            {list.map((name) => {
              const here = name === shown;
              return (
                <li key={name}>
                  <button
                    type="button"
                    aria-current={here ? "true" : undefined}
                    onClick={() => (session && here ? change(false) : pick(name))}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-meta text-ink -outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted"
                  >
                    <BranchIcon />
                    <Code tone="inherit" className="min-w-0 flex-1 truncate">{name}</Code>
                    {here ? <CheckIcon aria-hidden="true" className="text-clay-ink" /> : session ? <span className="shrink-0 text-faint">New session ↗</span> : null}
                  </button>
                </li>
              );
            })}
            {branches !== null && list.length === 0 && !canCreate ? <li className="px-2 py-1.5 text-meta text-faint">No branches.</li> : null}
            {canCreate ? (
              <li>
                <button
                  type="button"
                  onClick={() => create(q)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-meta text-ink -outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted"
                >
                  <PlusIcon />
                  <span className="min-w-0 flex-1 truncate">
                    Create <Code tone="inherit">{q}</Code>
                    {" "}
                    <span className="text-faint">{`from ${current ?? shown}${session ? ", in a new session" : ""}`}</span>
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-muted">
          <SearchIcon className="size-4 shrink-0" />
          <input
            aria-label="Search or create a branch"
            placeholder="Search or create a branch…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 border-0 bg-transparent text-meta text-ink outline-none placeholder:text-faint"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The line under the new-session composer when a branch is marked: golem switches the folder when you send. */
export function BranchSwitchLineView({ folder, from, to, create }: { folder: string | null; from: string | null; to: string; create: boolean }) {
  return (
    <p className="px-1 text-left text-xs text-muted">
      {create ? (
        <>
          golem creates <Code className="font-medium">{to}</Code> from {from ?? "the current branch"} in <b className="font-medium text-ink">{folderName(folder)}</b> when you send.
        </>
      ) : (
        <>
          golem switches <b className="font-medium text-ink">{folderName(folder)}</b> from {from ?? "the current branch"} to <Code className="font-medium">{to}</Code> when you send.
        </>
      )}
    </p>
  );
}

/** The marked branch on the empty screen, and what the folder is on now. Null while git has not answered or the folder is no repo. */
function useHomeBranch(folder: string | null) {
  const info = useGitInfo(folder);
  const [marked, setMarked] = useNewSessionBranch();
  const repo = info.data?.repository === true;
  const current = repo ? (info.data?.branch ?? null) : null;
  // A mark for a folder that stopped being a repo means nothing.
  return { info: info.data ?? null, repo, current, marked: repo ? marked : null, setMarked };
}

/** The branch chip of the empty screen: picking only marks a branch. golem switches the folder when the session starts. */
export function HomeBranchChip({ folder }: { folder: string | null }) {
  const { info, repo, current, marked, setMarked } = useHomeBranch(folder);
  const branches = useGitBranches(folder, repo);
  const list = useSessionList();
  const shown = marked?.name ?? current;
  if (!repo || shown === null) return null;
  const sharedWith = list
    .filter((session) => session.cwd === folder && session.status !== "closed")
    .map((session) => session.title ?? "A session");
  return (
    <BranchChipView
      mode="home"
      folder={folder}
      shown={shown}
      current={current}
      changed={info?.changed ?? 0}
      branches={branches.data === undefined ? null : branches.data.branches.map((branch) => branch.name)}
      sharedWith={sharedWith}
      onPick={(name) => setMarked(name === current ? null : { name, create: false })}
      onCreate={(name) => setMarked({ name, create: true })}
    />
  );
}

/** The line under the empty screen's composer, or nothing when no branch is marked. */
export function BranchSwitchLine({ folder }: { folder: string | null }) {
  const { current, marked } = useHomeBranch(folder);
  if (marked === null) return null;
  return <BranchSwitchLineView folder={folder} from={current} to={marked.name} create={marked.create} />;
}

const selectBranchChanged = (view: SessionView) => view.chat.branchChanged;

/**
 * The branch of a session in the composer's row. A session never switches: picking another branch goes
 * to the empty screen with this folder and that branch marked.
 */
export function SessionBranchChip({ sessionId }: { sessionId: string }) {
  const summary = useSessionList().find((session) => session.session_id === sessionId);
  const amber = useSession(sessionId, selectBranchChanged);
  const folder = summary?.cwd ?? null;
  const branch = summary?.branch ?? null;
  const info = useGitInfo(branch === null ? null : folder);
  const branches = useGitBranches(folder, branch !== null);
  const navigate = useNavigate();
  const [, chooseFolder] = useNewSessionFolder();
  const [, markBranch] = useNewSessionBranch();
  if (branch === null) return null;
  const startOn = (name: string, create: boolean) => {
    chooseFolder(folder);
    markBranch({ name, create });
    navigate("/");
  };
  return (
    <BranchChipView
      mode="session"
      folder={folder}
      shown={branch}
      current={branch}
      changed={info.data?.changed ?? 0}
      amber={amber}
      branches={branches.data === undefined ? null : branches.data.branches.map((item) => item.name)}
      onPick={(name) => startOn(name, false)}
      onCreate={(name) => startOn(name, true)}
    />
  );
}
