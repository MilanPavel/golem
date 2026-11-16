import { useId, useMemo, useRef, useState } from "react";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { FolderIcon, MoreIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/menu.tsx";
import { useNavigate, useRoute, useSessionList } from "../../store/page-context.tsx";
import { groupByFolder, type SessionSummary } from "../../store/session-list.ts";
import { sessionPath } from "../../store/router.ts";
import { CloseSessionDialog } from "./close-dialog.tsx";
import { folderName } from "./folder.ts";
import { forkRows, type ForkRow } from "./fork-tree.ts";
import { RenameField } from "./rename-field.tsx";
import { useSessionActions } from "./use-session-actions.ts";
import { timeAgo } from "./time-ago.ts";
import { useNow } from "./use-now.ts";

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
  const trigger = useRef<HTMLButtonElement>(null);
  const chose = useRef(false);
  const name = session.title ?? "Untitled";
  return (
    <li aria-level={row.depth + 1} className={cn("group relative", INDENT[row.indent])}>
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
            "flex items-center gap-2 rounded-md px-2.5 py-2 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2",
            selected && "bg-surface text-ink ring-1 ring-line ring-inset",
          )}
        >
          <SessionDot status={session.status} />
          {row.forked ? <ForkMark row={row} /> : null}
          {session.title ? (
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-faint">Untitled</span>
          )}
          <time dateTime={session.updated_at} className="shrink-0 font-mono text-xs text-faint">
            {timeAgo(session.updated_at, now)}
          </time>
        </Link>
      )}
      {onRename && onAskClose && !renaming ? (
        <Menu>
          <MenuTrigger asChild>
            <IconButton
              ref={trigger}
              label={`Actions for ${name}`}
              className="absolute top-1/2 right-1 size-6 -translate-y-1/2 bg-sunken opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
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
    </li>
  );
}

function FolderGroup({
  folder,
  sessions,
  selectedId,
  now,
  onNavigate,
  onRename,
  onAskClose,
}: {
  folder: string | null;
  sessions: SessionSummary[];
  selectedId: string | null;
  now: number;
  onNavigate: (path: string) => void;
  onRename?: (sessionId: string, title: string) => Promise<void>;
  onAskClose?: AskClose;
}) {
  const headingId = useId();
  return (
    <div>
      <div
        id={headingId}
        title={folder ?? undefined}
        className="mb-1 flex items-center gap-1.5 px-2.5 font-mono text-xs text-faint"
      >
        <FolderIcon className="size-3 shrink-0" />
        <span className="truncate">{folderName(folder)}</span>
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col gap-px">
        {forkRows(sessions).map((row) => (
          <SessionRow
            key={row.session.session_id}
            row={row}
            selected={row.session.session_id === selectedId}
            now={now}
            onNavigate={onNavigate}
            onRename={onRename}
            onAskClose={onAskClose}
          />
        ))}
      </ul>
    </div>
  );
}

export type SessionListProps = {
  sessions: readonly SessionSummary[];
  /** The session in view, if any. */
  selectedId: string | null;
  now: number;
  onNavigate: (path: string) => void;
  /** Rename and close from each row's menu. Without it the rows have no menu. */
  actions?: SidebarActions;
};

/** The sessions by folder, closed ones left out, with the dialog that confirms a close. */
export function SessionList({ sessions, selectedId, now, onNavigate, actions }: SessionListProps) {
  const [closing, setClosing] = useState<SessionSummary | null>(null);
  // Where focus goes when the dialog shuts: the row's menu button, or the list once the row is gone.
  const closeTrigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const askClose: AskClose = (session, trigger) => {
    closeTrigger.current = trigger;
    setClosing(session);
  };
  const shown = sessions.filter((session) => session.status !== "closed");
  return (
    <div ref={list} tabIndex={-1} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5 outline-none">
      {groupByFolder(shown).map((group) => (
        <FolderGroup
          key={group.folder ?? ""}
          folder={group.folder}
          sessions={group.sessions}
          selectedId={selectedId}
          now={now}
          onNavigate={onNavigate}
          onRename={actions?.rename}
          onAskClose={actions ? askClose : undefined}
        />
      ))}
      {actions ? (
        <CloseSessionDialog
          open={closing !== null}
          onOpenChange={(open) => {
            if (!open) setClosing(null);
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
  );
}

/** The session list on the live page. It refreshes its "2m" labels once a minute. */
export function LiveSessionList() {
  const sessions = useSessionList();
  const route = useRoute();
  const navigate = useNavigate();
  const now = useNow();
  const { rename, close } = useSessionActions();
  const actions = useMemo(() => ({ rename, close }), [rename, close]);
  return (
    <SessionList
      sessions={sessions}
      selectedId={route.name === "session" ? route.id : null}
      now={now}
      onNavigate={navigate}
      actions={actions}
    />
  );
}
