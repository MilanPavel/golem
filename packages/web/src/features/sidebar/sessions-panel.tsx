import { useId, useMemo, useRef, useState } from "react";
import { groupByTime } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { ClockIcon, MoreIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { Input } from "../../ui/input.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/menu.tsx";
import { useNavigate, useRoute, useSessionList } from "../../store/page-context.tsx";
import type { SessionSummary } from "../../store/session-list.ts";
import { sessionPath } from "../../store/router.ts";
import { CloseSessionDialog } from "../sessions/close-dialog.tsx";
import { folderName } from "../sessions/folder.ts";
import { forkRows, type ForkRow } from "../sessions/fork-tree.ts";
import { RenameField } from "../sessions/rename-field.tsx";
import { useSessionActions } from "../sessions/use-session-actions.ts";
import { timeAgo } from "../sessions/time-ago.ts";
import { useNow } from "../sessions/use-now.ts";

const DOT: Record<"idle" | "running" | "waiting", string> = {
  idle: "border border-line-strong",
  running: "bg-clay animate-pulse",
  waiting: "bg-wait",
};

function SessionDot({ status }: { status: SessionSummary["status"] }) {
  const state = status === "running" || status === "waiting" ? status : "idle";
  return (
    <span className="inline-flex w-3.5 shrink-0 justify-center">
      <span aria-hidden="true" className={cn("size-2 rounded-xs", DOT[state])} />
      <span className="sr-only">{state}</span>
    </span>
  );
}

const INDENT = ["", "pl-3", "pl-6", "pl-9"] as const;

/** What the sidebar can do to a session. Without it a row has no menu. */
export type SidebarActions = {
  rename: (sessionId: string, title: string) => Promise<void>;
  close: (sessionId: string) => Promise<void>;
};

/** A row asks to close its session; `trigger` is its menu button, for focus afterwards. */
type AskClose = (session: SessionSummary, trigger: HTMLButtonElement | null) => void;

function ForkMark({ row }: { row: ForkRow }) {
  return (
    <>
      <span aria-hidden="true" className="shrink-0 text-faint">
        ⑂
      </span>
      <span className="sr-only">
        {row.parentShown ? (row.parentTitle ? `fork of ${row.parentTitle}` : "fork of an untitled session") : "fork"}
      </span>
    </>
  );
}

function SessionRow({
  row,
  selected,
  now,
  onNavigate,
  onRename,
  onAskClose,
}: {
  row: ForkRow;
  selected: boolean;
  now: number;
  onNavigate: (path: string) => void;
  onRename?: (sessionId: string, title: string) => Promise<void>;
  onAskClose?: AskClose;
}) {
  const { session } = row;
  const href = sessionPath(session.session_id);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const chose = useRef(false);
  const name = session.title ?? "Untitled";
  const hasMenu = onRename !== undefined && onAskClose !== undefined;
  const routine = session.origin?.startsWith("routine:") === true;
  return (
    <li
      aria-level={row.depth + 1}
      className={cn("group relative", INDENT[row.indent])}
      onContextMenu={
        hasMenu && !renaming
          ? (event) => {
              event.preventDefault();
              setMenuOpen(true);
            }
          : undefined
      }
    >
      {renaming && onRename ? (
        <div className="flex items-center gap-2 px-2.5 py-1">
          <SessionDot status={session.status} />
          <RenameField
            initial={session.title ?? ""}
            label={`Rename ${name}`}
            onSave={(title) => onRename(session.session_id, title)}
            onEnd={(how) => {
              setRenaming(false);
              if (how !== "blur") requestAnimationFrame(() => trigger.current?.focus());
            }}
          />
        </div>
      ) : (
        <Link
          href={href}
          onNavigate={onNavigate}
          aria-current={selected ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md py-1.5 pr-11 pl-2.5 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2",
            selected && "bg-surface text-ink ring-1 ring-line ring-inset",
          )}
        >
          <SessionDot status={session.status} />
          {row.forked ? <ForkMark row={row} /> : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn("min-w-0 truncate", !session.title && "text-faint")}>{name}</span>
              {routine ? (
                <>
                  <ClockIcon className="size-3 shrink-0 text-faint" />
                  <span className="sr-only">started by a routine</span>
                </>
              ) : null}
            </span>
            {session.cwd ? (
              <span title={session.cwd} className="truncate font-mono text-xs text-faint">
                {folderName(session.cwd)}
              </span>
            ) : null}
          </span>
        </Link>
      )}
      {renaming ? null : (
        // One fixed-width slot at the right: the time, and over it the menu button when the row is
        // hovered or holds focus. Both sit in the same grid cell, so the title never moves.
        <span data-slot="row-end" className="pointer-events-none absolute top-0 right-1.5 bottom-0 grid w-9 place-items-center">
          <time
            dateTime={session.updated_at}
            className={cn(
              "col-start-1 row-start-1 font-mono text-xs text-faint",
              hasMenu && "group-focus-within:opacity-0 group-hover:opacity-0",
              hasMenu && menuOpen && "opacity-0",
            )}
          >
            {timeAgo(session.updated_at, now)}
          </time>
          {hasMenu ? (
            <Menu open={menuOpen} onOpenChange={setMenuOpen}>
              <MenuTrigger asChild>
                <IconButton
                  ref={trigger}
                  label={`Actions for ${name}`}
                  className="pointer-events-auto col-start-1 row-start-1 size-6 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreIcon />
                </IconButton>
              </MenuTrigger>
              <MenuContent
                onCloseAutoFocus={(event) => {
                  // The next thing takes focus: the rename field, or the confirm dialog.
                  if (chose.current) {
                    chose.current = false;
                    event.preventDefault();
                  }
                }}
              >
                <MenuItem
                  onSelect={() => {
                    chose.current = true;
                    setRenaming(true);
                  }}
                >
                  Rename
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    chose.current = true;
                    onAskClose(session, trigger.current);
                  }}
                >
                  Close
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
        </span>
      )}
    </li>
  );
}

/** Rows for one root: the session, then its forks. */
type Chunk = { root: SessionSummary; rows: ForkRow[] };

function TimeGroupSection({
  label,
  chunks,
  selectedId,
  now,
  onNavigate,
  onRename,
  onAskClose,
}: {
  label: string;
  chunks: Chunk[];
  selectedId: string | null;
  now: number;
  onNavigate: (path: string) => void;
  onRename?: (sessionId: string, title: string) => Promise<void>;
  onAskClose?: AskClose;
}) {
  const headingId = useId();
  return (
    <div>
      <div id={headingId} className="mb-1 px-2.5 text-xs font-medium text-faint">
        {label}
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col gap-px">
        {chunks.flatMap((chunk) =>
          chunk.rows.map((row) => (
            <SessionRow
              key={row.session.session_id}
              row={row}
              selected={row.session.session_id === selectedId}
              now={now}
              onNavigate={onNavigate}
              onRename={onRename}
              onAskClose={onAskClose}
            />
          )),
        )}
      </ul>
    </div>
  );
}

/** Roots grouped by time; each root keeps the forks under it, whatever their own time. */
function timeChunks(sessions: readonly SessionSummary[], now: number): { label: string; chunks: Chunk[] }[] {
  const byRoot = new Map<string, ForkRow[]>();
  const roots: SessionSummary[] = [];
  let current: ForkRow[] | null = null;
  for (const row of forkRows(sessions)) {
    if (row.depth === 0) {
      current = [row];
      byRoot.set(row.session.session_id, current);
      roots.push(row.session);
    } else {
      current?.push(row);
    }
  }
  return groupByTime(roots, now).map((group) => ({
    label: group.label,
    chunks: group.items.map((root) => ({ root, rows: byRoot.get(root.session_id) ?? [] })),
  }));
}

export type SessionsPanelProps = {
  sessions: readonly SessionSummary[];
  /** The session in view, if any. */
  selectedId: string | null;
  now: number;
  onNavigate: (path: string) => void;
  /** Rename and close from each row's menu. Without it the rows have no menu. */
  actions?: SidebarActions;
};

/** The sessions panel's body: a filter, then sessions by time, closed ones left out. */
export function SessionsPanel({ sessions, selectedId, now, onNavigate, actions }: SessionsPanelProps) {
  const [closing, setClosing] = useState<SessionSummary | null>(null);
  const [filter, setFilter] = useState("");
  // Where focus goes when the dialog shuts: the row's menu button, or the list once the row is gone.
  const closeTrigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const askClose: AskClose = (session, trigger) => {
    closeTrigger.current = trigger;
    setClosing(session);
  };
  const open = useMemo(() => sessions.filter((session) => session.status !== "closed"), [sessions]);
  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle === ""
        ? open
        : open.filter(
            (session) =>
              (session.title ?? "").toLowerCase().includes(needle) ||
              (session.cwd ? folderName(session.cwd) : "").toLowerCase().includes(needle),
          ),
    [open, needle],
  );
  const groups = useMemo(() => timeChunks(shown, now), [shown, now]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        type="text"
        aria-label="Filter sessions"
        placeholder="Filter sessions"
        autoComplete="off"
        spellCheck={false}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && filter !== "") {
            event.preventDefault();
            setFilter("");
          }
        }}
        className="py-1.5"
      />
      <div ref={list} tabIndex={-1} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5 outline-none">
        {groups.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted">{open.length === 0 ? "No sessions yet." : "No sessions match."}</p>
        ) : (
          groups.map((group) => (
            <TimeGroupSection
              key={group.label}
              label={group.label}
              chunks={group.chunks}
              selectedId={selectedId}
              now={now}
              onNavigate={onNavigate}
              onRename={actions?.rename}
              onAskClose={actions ? askClose : undefined}
            />
          ))
        )}
        {actions ? (
          <CloseSessionDialog
            open={closing !== null}
            onOpenChange={(isOpen) => {
              if (!isOpen) setClosing(null);
            }}
            onConfirm={() => (closing ? actions.close(closing.session_id) : Promise.resolve())}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = closeTrigger.current;
              closeTrigger.current = null;
              (trigger?.isConnected ? trigger : list.current)?.focus();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The sessions panel on the live page. It refreshes its "2m" labels once a minute. */
export function LiveSessionsPanel() {
  const sessions = useSessionList();
  const route = useRoute();
  const navigate = useNavigate();
  const now = useNow();
  const { rename, close } = useSessionActions();
  const actions = useMemo(() => ({ rename, close }), [rename, close]);
  return (
    <SessionsPanel
      sessions={sessions}
      selectedId={route.name === "session" ? route.id : null}
      now={now}
      onNavigate={navigate}
      actions={actions}
    />
  );
}
