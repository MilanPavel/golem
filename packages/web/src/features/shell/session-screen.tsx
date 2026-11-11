import { forkPoint, type TodoItem } from "@golem/view";
import { INSPECTOR_ID, InspectorPanel } from "../trace/index.ts";
import { useEffect, useMemo, useRef, type ReactNode, type Ref, type RefObject } from "react";
import { Badge, badgeVariants } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { FolderIcon, InspectIcon, PanelIcon } from "../../ui/icons.tsx";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { useNavigate, useRememberOpenedFolder, useRoute, useSession, useSessionList } from "../../store/page-context.tsx";
import { inspectPath, sessionPath } from "../../store/router.ts";
import { hasMod, modShortcut } from "../../ui/platform.ts";
import type { SessionModel, SessionView } from "../../store/session-store.ts";
import { DetailSwitch, Transcript } from "../chat/index.ts";
import { SessionDock } from "../composer/index.ts";
import { Drawer, DRAWER_ID, useDrawerOpen } from "../drawer/index.ts";
import { closeModelDialog, ModelDialog, openModelDialog, useModelDialogOpen } from "../models/index.ts";
import { folderName, useSessionActions } from "../sessions/index.ts";
import { useRememberSettingsContext } from "../settings/index.ts";
import { SessionTitle } from "./session-title.tsx";

type Header = Pick<SessionView, "title" | "cwd" | "model" | "status">;

function sameHeader(a: Header, b: Header): boolean {
  return a.title === b.title && a.cwd === b.cwd && a.model === b.model && a.status === b.status;
}

const selectTodos = (view: SessionView) => view.chat.todos;

const selectForkPoint = (view: SessionView) => forkPoint(view.chat.messages);

const selectHeader = (view: SessionView): Header => ({
  title: view.title,
  cwd: view.cwd,
  model: view.model,
  status: view.status,
});

/** The transcript: it is the scrolling column. */
export function TranscriptSlot({ id }: { id: string }) {
  return <Transcript id={id} />;
}

/** The meter, the composer, and the key hints. */
export function DockSlot({ id }: { id: string }) {
  return <SessionDock key={id} sessionId={id} />;
}

/** The session's model. It opens the dialog that switches it. */
function ModelChip({
  sessionId,
  model,
  buttonRef,
}: {
  sessionId: string;
  model: SessionModel;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const detail = [model.profile, model.provider].filter((part) => part !== null).join(" · ");
  const name = model.name ?? model.profile;
  return (
    <button
      ref={buttonRef}
      type="button"
      title={detail}
      aria-label={`Model: ${name}`}
      aria-haspopup="dialog"
      onClick={() => openModelDialog({ sessionId, returnTo: "chip" })}
      className={`${badgeVariants()} cursor-pointer outline-offset-2 outline-clay hover:border-ink hover:text-ink focus-visible:outline-2`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-allow" />
      {name}
    </button>
  );
}

/** The one model dialog of the session. The chip and `/model` open it; it closes with the session. */
function SessionModelDialog({
  sessionId,
  model,
  chip,
}: {
  sessionId: string;
  model: SessionModel | null;
  chip: RefObject<HTMLButtonElement | null>;
}) {
  const open = useModelDialogOpen(sessionId);
  // The store is cleared before the dialog reports its close, so remember where focus goes back to.
  const returnTo = useRef<"chip" | HTMLElement | null>("chip");
  useEffect(() => {
    if (open !== null) returnTo.current = open.returnTo;
  }, [open]);
  useEffect(() => closeModelDialog, [sessionId]);
  return (
    <ModelDialog
      sessionId={sessionId}
      session={model === null ? null : { profile: model.profile, name: model.name }}
      open={open !== null}
      initial={open?.initial}
      onOpenChange={(next) => {
        if (!next) closeModelDialog();
      }}
      onCloseAutoFocus={(event) => {
        // The dialog has no trigger of its own, so focus goes back by hand: to the chip, or to
        // the composer that ran the command.
        event.preventDefault();
        const target = returnTo.current === "chip" ? chip.current : returnTo.current;
        target?.focus();
      }}
    />
  );
}

export function TopBar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-13 items-center gap-2.5 border-b border-line px-4 py-2.5">
      {title}
      <div className="flex-1" />
      <div className="flex min-w-0 gap-1.5">{children}</div>
    </header>
  );
}

/** The calm screen for a session the daemon no longer has. */
export function GoneScreen() {
  const navigate = useNavigate();
  return (
    <div data-screen="gone" className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-5">
      <div className="flex max-w-lg flex-col items-center gap-4 text-center">
        <PixelGolem state="offline" size="lg" />
        <h1 className="font-prose text-2xl font-normal tracking-tight text-balance">This session is gone</h1>
        <p className="text-pretty text-muted">The daemon no longer has it. It may have been closed.</p>
        <Button onClick={() => navigate("/")}>Back to start</Button>
      </div>
    </div>
  );
}

/** The top bar's switch for the drawer; closed, it shows how far the todos are. */
function DrawerToggle({
  open,
  todos,
  onToggle,
  ref,
}: {
  open: boolean;
  todos: readonly TodoItem[];
  onToggle: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const done = todos.filter((todo) => todo.status === "done").length;
  const count = !open && todos.length > 0 ? `${done}/${todos.length}` : null;
  return (
    <Button
      kind="ghost"
      size="sm"
      aria-label={open ? "Hide details" : "Show details"}
      aria-expanded={open}
      aria-controls={DRAWER_ID}
      title={count === null ? undefined : `${done} of ${todos.length} todos done`}
      onClick={onToggle}
      ref={ref}
      className="h-8 min-w-8 rounded-sm px-2"
    >
      <PanelIcon />
      {count === null ? null : (
        <span aria-hidden="true" className="font-mono text-xs text-muted">
          {count}
        </span>
      )}
    </Button>
  );
}

/** The top bar's switch for the trace inspector beside the chat. */
function InspectToggle({ open, onToggle, ref }: { open: boolean; onToggle: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <Button
      kind="ghost"
      size="sm"
      aria-label="Inspect"
      aria-pressed={open}
      aria-controls={open ? INSPECTOR_ID : undefined}
      title={`Inspect (${modShortcut(".")})`}
      onClick={onToggle}
      ref={ref}
      className="h-8 min-w-8 rounded-sm px-2"
    >
      <InspectIcon />
    </Button>
  );
}

/**
 * The chrome both views of a session share: the top bar with the title, the model chip, the
 * folder, and the drawer toggle, the model dialog, and the drawer. The view goes in the column
 * below the top bar. A session the daemon no longer has shows the gone screen instead.
 */
export function SessionFrame({ id, children }: { id: string; children: ReactNode }) {
  const header = useSession(id, selectHeader, sameHeader);
  const summary = useSessionList().find((session) => session.session_id === id);
  const remember = useRememberOpenedFolder();
  const todos = useSession(id, selectTodos);
  const [drawerOpen, setDrawerOpen] = useDrawerOpen();
  const toggle = useRef<HTMLButtonElement>(null);
  const inspectToggle = useRef<HTMLButtonElement>(null);
  const route = useRoute();
  const navigate = useNavigate();
  const inspect = route.name === "session" ? route.inspect : null;
  const chip = useRef<HTMLButtonElement>(null);
  const atMessage = useSession(id, selectForkPoint);
  const session = useSessionActions();
  const titleActions = useMemo(
    () => ({
      rename: (next: string) => session.rename(id, next),
      fork: () => (atMessage === null ? Promise.reject(new Error("Nothing to fork yet.")) : session.fork(id, atMessage)),
      close: () => session.close(id),
    }),
    [session, id, atMessage],
  );

  const title = header.title ?? summary?.title ?? null;
  const cwd = summary ? (summary.cwd ?? null) : header.status === "ready" ? header.cwd : undefined;
  const model: SessionModel | null =
    header.model ?? (summary ? { profile: summary.model_profile, provider: null, name: null } : null);

  useEffect(() => {
    if (cwd !== undefined) {
      remember(cwd);
    }
  }, [cwd, remember]);
  useRememberSettingsContext(id, cwd);

  // ⌘. (Ctrl+. elsewhere) toggles the inspector from anywhere on the chat.
  const inspecting = inspect !== null;
  useEffect(() => {
    if (route.name !== "session") return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.key !== "." || !hasMod(event) || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(inspecting ? sessionPath(id) : inspectPath(id), { replace: true });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [route.name, inspecting, id, navigate]);

  if (header.status === "gone") {
    return <GoneScreen />;
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar title={<SessionTitle title={title || null} canFork={atMessage !== null} actions={titleActions} />}>
          <DetailSwitch />
          {model ? <ModelChip sessionId={id} model={model} buttonRef={chip} /> : null}
          {cwd === undefined ? null : (
            <Badge title={cwd ?? undefined}>
              <FolderIcon className="size-3" />
              {folderName(cwd)}
            </Badge>
          )}
          {route.name === "session" ? (
            <InspectToggle
              ref={inspectToggle}
              open={inspecting}
              onToggle={() => navigate(inspecting ? sessionPath(id) : inspectPath(id), { replace: true })}
            />
          ) : null}
          <DrawerToggle ref={toggle} open={drawerOpen} todos={todos} onToggle={() => setDrawerOpen(!drawerOpen)} />
        </TopBar>
        {children}
      </div>
      {inspect === null ? null : (
        <InspectorPanel
          id={id}
          span={inspect.span}
          onClose={() => {
            // The panel goes away with its close button, so focus goes back to the toggle.
            navigate(sessionPath(id), { replace: true });
            inspectToggle.current?.focus();
          }}
        />
      )}
      <SessionModelDialog sessionId={id} model={model} chip={chip} />
      {drawerOpen ? (
        <Drawer
          todos={todos}
          onClose={() => {
            // The drawer's own button goes away with it, so focus goes back to the toggle.
            setDrawerOpen(false);
            toggle.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** The chat view's part of the column: the transcript and the dock. */
export function ChatView({ id }: { id: string }) {
  return (
    <>
      <TranscriptSlot id={id} />
      <div className="mx-auto w-full max-w-column px-5 pb-4">
        <DockSlot id={id} />
      </div>
    </>
  );
}

/** The chat view in the session's frame. */
export function SessionScreen({ id }: { id: string }) {
  return (
    <SessionFrame id={id}>
      <ChatView id={id} />
    </SessionFrame>
  );
}
