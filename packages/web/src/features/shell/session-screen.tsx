import { useEffect } from "react";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { FolderIcon } from "../../ui/icons.tsx";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { useNavigate, useRememberOpenedFolder, useSession, useSessionList } from "../../store/page-context.tsx";
import type { SessionModel, SessionView } from "../../store/session-store.ts";
import { folderName } from "../sessions/folder.ts";

type Header = Pick<SessionView, "title" | "cwd" | "model" | "status">;

function sameHeader(a: Header, b: Header): boolean {
  return a.title === b.title && a.cwd === b.cwd && a.model === b.model && a.status === b.status;
}

const selectHeader = (view: SessionView): Header => ({
  title: view.title,
  cwd: view.cwd,
  model: view.model,
  status: view.status,
});

/** The transcript goes here (step 10.8.3). */
export function TranscriptSlot() {
  return <p className="text-sm text-faint">The conversation will appear here.</p>;
}

/** The meter and the composer go here (step 10.8.4). */
export function DockSlot() {
  return null;
}

function ModelChip({ model }: { model: SessionModel }) {
  const detail = [model.profile, model.provider].filter((part) => part !== null).join(" · ");
  return (
    <Badge title={detail}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-allow" />
      {model.name ?? model.profile}
    </Badge>
  );
}

export function TopBar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="flex min-h-13 items-center gap-2.5 border-b border-line px-4 py-2.5">
      <h1 className="min-w-0 truncate text-sm leading-snug font-semibold">{title}</h1>
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

/** A session: the top bar, then the column with the transcript's and the dock's slots. */
export function SessionScreen({ id }: { id: string }) {
  const header = useSession(id, selectHeader, sameHeader);
  const summary = useSessionList().find((session) => session.session_id === id);
  const remember = useRememberOpenedFolder();

  const title = header.title ?? summary?.title ?? null;
  const cwd = summary ? (summary.cwd ?? null) : header.status === "ready" ? header.cwd : undefined;
  const model: SessionModel | null =
    header.model ?? (summary ? { profile: summary.model_profile, provider: null, name: null } : null);

  useEffect(() => {
    if (cwd !== undefined) {
      remember(cwd);
    }
  }, [cwd, remember]);

  if (header.status === "gone") {
    return <GoneScreen />;
  }
  return (
    <>
      <TopBar title={title || "New session"}>
        {model ? <ModelChip model={model} /> : null}
        {cwd === undefined ? null : (
          <Badge title={cwd ?? undefined}>
            <FolderIcon className="size-3" />
            {folderName(cwd)}
          </Badge>
        )}
      </TopBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-column flex-col gap-6 px-5 py-7">
          <TranscriptSlot />
        </div>
      </div>
      <div className="mx-auto w-full max-w-column px-5 pb-4">
        <DockSlot />
      </div>
    </>
  );
}
