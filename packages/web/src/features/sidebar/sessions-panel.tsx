import { useId, useMemo, useRef, useState } from "react";
import {
  groupByTime,
  groupHelpers,
  helperWords,
  type HelperCardSession,
  helperLabel,
  helperRowState,
  type HelperRowState,
  isRoutineSession,
  queuedWords,
  sessionState,
  type HelperSquare,
  type SessionState,
} from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { ClockIcon, FolderIcon, MoreIcon, SlidersIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { Input } from "../../ui/input.tsx";
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuTrigger } from "../../ui/menu.tsx";
import { useShowHelpers } from "./show-helpers.ts";
import { HelperRowCard, SQUARE, type HelperCardActions } from "./helper-row-card.tsx";
import { openHelper, useHelperOpen } from "../chat/index.ts";
import { useNavigate, usePageActions, useRoute, useSessionList } from "../../store/page-context.tsx";
import type { SessionSummary } from "../../store/session-list.ts";
import { sessionPath } from "../../store/router.ts";
import { CloseSessionDialog } from "../sessions/close-dialog.tsx";
import { folderName } from "../sessions/folder.ts";
import { forkRows, type ForkRow } from "../sessions/fork-tree.ts";
import { RenameField } from "../sessions/rename-field.tsx";
import { useSessionActions } from "../sessions/use-session-actions.ts";
import { timeAgo } from "../sessions/time-ago.ts";
import { useNow } from "../sessions/use-now.ts";

const DOT: Record<SessionState, string> = {
  idle: "border border-line-strong",
  running: "bg-clay animate-pulse",
  waiting: "bg-wait",
  // A ring in the running colour: the run is open, but its call has not started.
  queued: "border border-clay",
};

function SessionDot({ session }: { session: SessionSummary }) {
  const state = sessionState(session);
  const words = queuedWords(session, "web");
  return (
    <span className="inline-flex w-3.5 shrink-0 justify-center" title={words ?? undefined}>
      <span aria-hidden="true" className={cn("size-2 rounded-xs", DOT[state])} />
      <span className="sr-only">{words === null ? state : `${state}, ${words}`}</span>
    </span>
  );
}

/** One small square for each helper that is not done, next to the folder. Nothing when all are done. */
function HelperSquares({ squares }: { squares: readonly HelperSquare[] }) {
  const words = helperWords(squares);
  if (words === null) return null;
  return (
    <span data-testid="helper-squares" title={words} className="flex shrink-0 items-center gap-0.5">
      <span aria-hidden="true" className="flex items-center gap-0.5">
        {squares.map((square, index) => (
          <span key={index} data-square={square} className={cn("size-1.5 rounded-xs", SQUARE[square])} />
        ))}
      </span>
      <span className="sr-only">{words}</span>
    </span>
  );
}

const INDENT =["", "pl-3", "pl-6", "pl-9"] as const;

/** What the sidebar can do to a session. Without it a row has no menu. */
export type SidebarActions = {
  rename: (sessionId: string, title: string) => Promise<void>;
  close: (sessionId: string) => Promise<void>;
};

/** A row asks to close its session; `trigger` is its menu button, for focus afterwards. */
type AskClose = (session: SessionSummary, trigger: HTMLButtonElement | null) => void;

/** What a screen reader hears for a fork; the grey tag in the folder line is what you see. */
function ForkMark({ row }: { row: ForkRow }) {
  return (
    <span className="sr-only">
      {row.parentShown ? (row.parentTitle ? `fork of ${row.parentTitle}` : "fork of an untitled session") : "fork"}
    </span>
  );
}

const HELPER_DOT: Record<HelperRowState, string> = {
  working: "bg-clay animate-pulse",
  queued: "border border-clay",
  asking: "bg-wait",
  done: "bg-allow",
};

const HELPER_STATE_WORDS: Record<HelperRowState, string> = { working: "working", queued: "queued", asking: "asks you", done: "done" };

/**
 * A helper under its lead: lighter than a chat row, a clay bar on the left, the agent type and then the
 * brief. No folder and no time of its own. Its click opens the helper.
 */
function HelperTreeRow({
  helper,
  leadId,
  leadTitle,
  level,
  selected,
  onOpen,
}: {
  helper: SessionSummary;
  leadId: string;
  leadTitle: string;
  level: number;
  selected: boolean;
  onOpen: (leadId: string, helperId: string) => void;
}) {
  const state = helperRowState(helper);
  const { agent, brief } = helperLabel(helper);
  const words = HELPER_STATE_WORDS[state];
  return (
    <li aria-level={level} data-helper-row={state} className="ml-4">
      <Link
        href={sessionPath(leadId)}
        onNavigate={() => onOpen(leadId, helper.session_id)}
        aria-current={selected ? "true" : undefined}
        title={brief === "" ? undefined : brief}
        className={cn(
          "flex items-center gap-2 rounded-md border-l-2 border-clay py-1 pr-2 pl-2.5 text-xs text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2",
          selected && "bg-surface text-ink ring-1 ring-line ring-inset",
        )}
      >
        <span aria-hidden="true" data-square={state} className={cn("size-2 shrink-0 rounded-xs", HELPER_DOT[state])} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-ink">{agent}</span>
          {brief === "" ? null : ` · ${brief}`}
        </span>
        <span className="shrink-0 text-faint">{words}</span>
        <span className="sr-only">{`helper of ${leadTitle}`}</span>
      </Link>
    </li>
  );
}

function SessionRow({
  row,
  squares,
  helpers,
  cardActions,
  selected,
  now,
  onNavigate,
  onRename,
  onAskClose,
}: {
  row: ForkRow;
  squares: readonly HelperSquare[];
  /** The summaries of its helpers that are not done, for the card. */
  helpers: readonly HelperCardSession[];
  cardActions?: HelperCardActions;
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
  const routine = isRoutineSession(session);
  const item = (
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
          <SessionDot session={session} />
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
            "flex items-center gap-2 rounded-md py-1.5 pr-2 pl-2.5 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2",
            selected && "bg-surface text-ink ring-1 ring-line ring-inset",
          )}
        >
          <SessionDot session={session} />
          {row.forked ? <ForkMark row={row} /> : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("flex min-w-0 items-center gap-1.5", hasMenu && "pr-6")}>
              <span className={cn("min-w-0 truncate", !session.title && "text-faint")}>{name}</span>
              {routine ? (
                <>
                  <ClockIcon className="size-3 shrink-0 text-faint" />
                  <span className="sr-only">started by a routine</span>
                </>
              ) : null}
              {row.forked ? (
                <span aria-hidden="true" data-testid="fork-tag" className="shrink-0 rounded-xs border border-line-strong px-1 text-xs text-faint">
                  fork
                </span>
              ) : null}
            </span>
            <span className="flex items-center gap-2">
              {session.cwd ? (
                <span title={session.cwd} className="flex min-w-0 items-center gap-1 text-meta text-faint">
                  <FolderIcon className="size-3 shrink-0 text-faint" aria-hidden="true" />
                  <Code tone="muted" className="truncate">{folderName(session.cwd)}</Code>
                </span>
              ) : null}
              <HelperSquares squares={squares} />
              <time dateTime={session.updated_at} className="ml-auto shrink-0 text-meta text-faint">
                {timeAgo(session.updated_at, now)}
              </time>
            </span>
          </span>
        </Link>
      )}
      {renaming || !hasMenu ? null : (
        // The menu button sits at the right end of the title line, outside the link. The title
        // keeps its width free (pr-6), so nothing moves when the button shows.
        <span className="absolute top-1 right-1.5">
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger asChild>
              <IconButton
                ref={trigger}
                label={`Actions for ${name}`}
                tooltip="More actions"
                className="size-6 opacity-0 hover:bg-line-strong group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
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
        </span>
      )}
    </li>
  );
  return (
    <HelperRowCard helpers={helpers} leadId={session.session_id} title={name} now={now} actions={cardActions}>
      {item}
    </HelperRowCard>
  );
}

/** Rows for one root: the session, then its forks. */
type Chunk = { root: SessionSummary; rows: ForkRow[] };

function TimeGroupSection({
  label,
  chunks,
  squares,
  helpers,
  nested,
  cardActions,
  selectedId,
  openHelperId,
  now,
  onNavigate,
  onRename,
  onAskClose,
}: {
  label: string;
  chunks: Chunk[];
  squares: ReadonlyMap<string, readonly HelperSquare[]>;
  helpers: ReadonlyMap<string, readonly HelperCardSession[]>;
  /** The helpers shown as rows under a lead. Such a lead shows no squares and no card. */
  nested: ReadonlyMap<string, readonly SessionSummary[]>;
  openHelperId: string | null;
  cardActions?: HelperCardActions;
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
          chunk.rows.flatMap((row) => {
            const id = row.session.session_id;
            const under = nested.get(id) ?? [];
            const open = (leadId: string, helperId: string) => (cardActions ? cardActions.open(leadId, helperId) : onNavigate(sessionPath(leadId)));
            return [
              <SessionRow
                key={id}
                row={row}
                squares={under.length > 0 ? [] : (squares.get(id) ?? [])}
                helpers={under.length > 0 ? [] : (helpers.get(id) ?? [])}
                cardActions={cardActions}
                selected={id === selectedId && openHelperId === null}
                now={now}
                onNavigate={onNavigate}
                onRename={onRename}
                onAskClose={onAskClose}
              />,
              ...under.map((helper) => (
                <HelperTreeRow
                  key={helper.session_id}
                  helper={helper}
                  leadId={id}
                  leadTitle={row.session.title ?? "Untitled"}
                  level={row.depth + 2}
                  selected={helper.session_id === openHelperId}
                  onOpen={open}
                />
              )),
            ];
          }),
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
  /** The helper the chat shows in its panel, if any. Its lead has its helpers as rows. */
  openHelperId?: string | null;
  now: number;
  onNavigate: (path: string) => void;
  /** Rename and close from each row's menu. Without it the rows have no menu. */
  actions?: SidebarActions;
  /** Open, Stop and the answer buttons of the helper card. Without it a lead shows its squares and no card. */
  helperActions?: HelperCardActions;
};

/** The sessions panel's body: a filter, then sessions by time, closed ones left out. */
export function SessionsPanel({ sessions, selectedId, openHelperId = null, now, onNavigate, actions, helperActions }: SessionsPanelProps) {
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
  const [showHelpers, setShowHelpers] = useShowHelpers();
  // A helper is not a row of its own (ADR-059). The filter reads the lead rows, and the helpers only with "Show helpers".
  // The lead in view, or the lead of the helper in view, shows its helpers as rows; with "Show helpers" every lead does.
  const grouped = useMemo(() => groupHelpers(open, { showHelpers, openId: openHelperId ?? selectedId }), [open, showHelpers, openHelperId, selectedId]);
  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () =>
      needle === ""
        ? grouped.rows
        : grouped.rows.filter(
            (session) =>
              (session.title ?? "").toLowerCase().includes(needle) ||
              (session.cwd ? folderName(session.cwd) : "").toLowerCase().includes(needle) ||
              (showHelpers && (grouped.nested.get(session.session_id) ?? []).some((helper) => (helper.title ?? "").toLowerCase().includes(needle))),
          ),
    [grouped, needle, showHelpers],
  );
  const groups = useMemo(() => timeChunks(shown, now), [shown, now]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
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
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="List options" tooltip="List options" className="size-8 shrink-0">
              <SlidersIcon />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuCheckboxItem checked={showHelpers} onCheckedChange={(next) => setShowHelpers(next === true)}>
              Show helpers
            </MenuCheckboxItem>
          </MenuContent>
        </Menu>
      </div>
      <div ref={list} tabIndex={-1} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5 outline-none">
        {groups.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted">{open.length === 0 ? "No sessions yet." : "No sessions match."}</p>
        ) : (
          groups.map((group) => (
            <TimeGroupSection
              key={group.label}
              label={group.label}
              chunks={group.chunks}
              squares={grouped.squares}
              helpers={grouped.helpers}
              nested={grouped.nested}
              openHelperId={openHelperId}
              cardActions={helperActions}
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
  const page = usePageActions();
  const openHelperId = useHelperOpen()?.helperId ?? null;
  const helperActions = useMemo<HelperCardActions>(
    () => ({
      open(leadId, helperId) {
        // The chat that shows keeps a helper opened for it (see `closeHelperOf`), so open first.
        openHelper({ helperId, leadId });
        navigate(sessionPath(leadId));
      },
      stop: (helperId) => page.stopHelper(helperId),
      answer: (helperId, callId, choice) => page.respond(helperId, callId, choice),
    }),
    [page, navigate],
  );
  return (
    <SessionsPanel
      sessions={sessions}
      selectedId={route.name === "session" ? route.id : null}
      openHelperId={openHelperId}
      now={now}
      onNavigate={navigate}
      actions={actions}
      helperActions={helperActions}
    />
  );
}
