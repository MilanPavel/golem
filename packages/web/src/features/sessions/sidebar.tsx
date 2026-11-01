import { useId } from "react";
import { cn } from "../../ui/cn.ts";
import { Button } from "../../ui/button.tsx";
import { GOLEM_STATE_LABEL } from "../../ui/golem-state.ts";
import { FolderIcon, PlusIcon } from "../../ui/icons.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { Link } from "../../ui/link.tsx";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { ThemeSwitch } from "../../theme-switch.tsx";
import type { ConnectionSnapshot } from "../../store/connection.ts";
import { useConnection } from "../../store/connection-context.tsx";
import { useNavigate, useRoute, useSessionList } from "../../store/page-context.tsx";
import { groupByFolder, type SessionSummary } from "../../store/session-list.ts";
import { sessionPath } from "../../store/router.ts";
import { ConnectionLine } from "../connection/index.ts";
import { folderName } from "./folder.ts";
import { overallState } from "./overall-state.ts";
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

function SessionRow({
  session,
  selected,
  now,
  onNavigate,
}: {
  session: SessionSummary;
  selected: boolean;
  now: number;
  onNavigate: (path: string) => void;
}) {
  const href = sessionPath(session.session_id);
  return (
    <li>
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
        {session.title ? (
          <span className="min-w-0 flex-1 truncate">{session.title}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-faint">Untitled</span>
        )}
        <time dateTime={session.updated_at} className="shrink-0 font-mono text-xs text-faint">
          {timeAgo(session.updated_at, now)}
        </time>
      </Link>
    </li>
  );
}

function FolderGroup({
  folder,
  sessions,
  selectedId,
  now,
  onNavigate,
}: {
  folder: string | null;
  sessions: SessionSummary[];
  selectedId: string | null;
  now: number;
  onNavigate: (path: string) => void;
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
        {sessions.map((session) => (
          <SessionRow
            key={session.session_id}
            session={session}
            selected={session.session_id === selectedId}
            now={now}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

export type SidebarViewProps = {
  sessions: readonly SessionSummary[];
  /** The session in view, if any. */
  selectedId: string | null;
  connection: ConnectionSnapshot;
  now: number;
  onNavigate: (path: string) => void;
  /** The landmark's name. A page has one sidebar; the gallery shows several and names each. */
  label?: string;
};

/** The sidebar of docs/design/web.md: golem's state, New session, sessions by folder, the connection and the theme. */
export function SidebarView({ sessions, selectedId, connection, now, onNavigate, label = "Sessions" }: SidebarViewProps) {
  const shown = sessions.filter((session) => session.status !== "closed");
  const state = overallState(connection.state.status === "connected", shown);
  return (
    <aside
      aria-label={label}
      className="flex h-full w-sidebar min-w-40 shrink flex-col gap-2.5 border-r border-line bg-sunken px-2.5 pt-3.5 pb-2.5 text-sm"
    >
      <div className="flex items-center gap-2.5 px-1.5 py-1">
        <PixelGolem state={state} size="sm" />
        <span className="text-lg leading-none font-semibold tracking-tight">golem</span>
        <span className="ml-auto font-mono text-xs text-muted">{GOLEM_STATE_LABEL[state]}</span>
      </div>
      <Button className="w-full justify-start" onClick={() => onNavigate("/")}>
        <PlusIcon />
        New session
        <Kbd className="ml-auto" aria-hidden="true">
          ⌘N
        </Kbd>
      </Button>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
        {groupByFolder(shown).map((group) => (
          <FolderGroup
            key={group.folder ?? ""}
            folder={group.folder}
            sessions={group.sessions}
            selectedId={selectedId}
            now={now}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-line px-2 pt-2.5">
        <ConnectionLine snapshot={connection} />
        <ThemeSwitch compact />
      </div>
    </aside>
  );
}

/** The sidebar on the live page. It refreshes its "2m" labels once a minute. */
export function Sidebar() {
  const sessions = useSessionList();
  const route = useRoute();
  const navigate = useNavigate();
  const connection = useConnection();
  const now = useNow();
  return (
    <SidebarView
      sessions={sessions}
      selectedId={route.name === "session" ? route.id : null}
      connection={connection}
      now={now}
      onNavigate={navigate}
    />
  );
}
