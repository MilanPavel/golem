import { golemState, loadingLine, waitText, withNotes, type PermissionMode, type RouteMode } from "@golem/view";
import { useMutation } from "@tanstack/react-query";
import { useConnection } from "../../store/connection-context.tsx";
import { actionErrorText, sendErrorText } from "../../store/errors.ts";
import { useDraft, useDraftPastes, useNotes, usePageActions, useSession } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { DockedApproval } from "../approval/docked-approval.tsx";
import { DockedChecksQuestion } from "./checks-question.tsx";
import { DockedConsent } from "../consent/docked-consent.tsx";
import { Composer } from "./composer.tsx";
import { ModeChip } from "./mode-chip.tsx";
import { PlanChip } from "./plan-chip.tsx";
import { NotesChip } from "./notes-chip.tsx";
import { RouteChip } from "./route-chip.tsx";
import { WaitHint } from "./wait-hint.tsx";
import { ContextBanner } from "./context-banner.tsx";
import { ContextChip } from "./context-chip.tsx";
import { TuneChip } from "./tune-chip.tsx";
import { useCommands } from "./use-commands.tsx";
import { DockView } from "./dock.tsx";
import { browserHistory } from "./history.ts";
import { Meter } from "./meter.tsx";

type Run = {
  busy: boolean;
  runId: string | null;
  runStartedAt: string | null;
  waiting: boolean;
  localWait: boolean;
  wait: string | null;
  loading: string | null;
  failed: boolean;
};

const selectRun = ({ chat }: SessionView): Run => ({
  busy: chat.busy,
  runId: chat.runId,
  runStartedAt: chat.runStartedAt,
  waiting: chat.approval !== null || chat.consent !== null,
  localWait: chat.localWait,
  wait: chat.wait === null ? null : waitText(chat.wait, "web"),
  loading: chat.loading === null ? null : loadingLine(chat.loading.model, chat.loading.window),
  failed: chat.error !== null,
});

const selectCwd = (view: SessionView) => view.cwd;
const selectActiveSkills = (view: SessionView) => view.chat.activeSkills;

const sameRun = (a: Run, b: Run): boolean =>
  a.busy === b.busy &&
  a.runId === b.runId &&
  a.runStartedAt === b.runStartedAt &&
  a.waiting === b.waiting &&
  a.localWait === b.localWait &&
  a.wait === b.wait &&
  a.loading === b.loading &&
  a.failed === b.failed;

/** The dock of a session: the meter, the composer, and the key hints. */
export function SessionDock({ sessionId }: { sessionId: string }) {
  const run = useSession(sessionId, selectRun, sameRun);
  const connection = useConnection().state.status;
  const actions = usePageActions();
  const [text, setText] = useDraft(sessionId);
  const [pastes, setPastes] = useDraftPastes(sessionId);

  const cwd = useSession(sessionId, selectCwd);
  const active = useSession(sessionId, selectActiveSkills);

  const send = useMutation({
    mutationFn: ({ text: message, skill }: { text: string; skill?: { name: string; args: string } }) =>
      actions.send(sessionId, message, skill),
  });
  const commands = useCommands({
    session: { id: sessionId, active },
    cwd,
    typing: text.startsWith("/"),
    send: (message, skill) => send.mutateAsync(skill === undefined ? { text: message } : { text: message, skill }),
  });
  const notes = useNotes(sessionId);
  const hasNotes = notes.state.notes.length > 0;
  // A slash command runs as typed; any other text goes out behind the notes. They are dropped only once the send worked.
  const sendWithNotes = async (raw: string) => {
    const typed = raw.trimStart();
    if (!hasNotes || (typed.startsWith("/") && !typed.startsWith("//"))) {
      return commands.run(raw);
    }
    const sent = notes.state.notes.map((note) => note.id);
    const result = await commands.run(withNotes(notes.state, raw));
    if (result === "sent") notes.drop(sent);
    return result;
  };
  const stop = useMutation({
    mutationFn: async () => {
      if (run.runId !== null) {
        await actions.cancel(run.runId);
      }
    },
  });

  const setMode = useMutation({
    mutationFn: (mode: PermissionMode | null) => actions.setMode(sessionId, mode),
  });

  const setPlan = useMutation({
    mutationFn: (on: boolean) => actions.setPlan(sessionId, on),
  });

  const setRoute = useMutation({
    mutationFn: (mode: RouteMode) => actions.setRoute(sessionId, mode),
  });

  const phase = run.waiting ? "waiting" : run.busy ? "thinking" : null;
  const state = golemState({ connection, phase, error: run.failed });
  const failure = send.error ?? stop.error;
  const line = commands.error ?? (setMode.error ? actionErrorText(setMode.error, "Could not change the mode.") : setRoute.error ? actionErrorText(setRoute.error, "Could not change the route.") : setPlan.error ? actionErrorText(setPlan.error, "Could not change plan first.") : failure ? sendErrorText(failure) : null);
  return (
    <>
      <DockView
        busy={run.busy}
        error={line}
        notice={commands.notice}
        meter={<Meter state={state} runStartedAt={run.runStartedAt} localWait={run.localWait} wait={run.wait} loading={run.loading} aside={
              <span className="flex items-center gap-2">
                <NotesChip sessionId={sessionId} />
                <TuneChip sessionId={sessionId} />
                <PlanChip sessionId={sessionId} onToggle={(on) => setPlan.mutate(on)} />
                <RouteChip sessionId={sessionId} onSelect={(mode) => setRoute.mutate(mode)} />
                <ModeChip sessionId={sessionId} onSelect={(mode) => setMode.mutate(mode)} />
                <ContextChip sessionId={sessionId} />
              </span>
            } />}
        approval={
          <>
            <DockedApproval sessionId={sessionId} />
            <DockedConsent sessionId={sessionId} />
          </>
        }
        question={<DockedChecksQuestion sessionId={sessionId} />}
        hint={
          <>
            <ContextBanner sessionId={sessionId} />
            <WaitHint sessionId={sessionId} />
          </>
        }
        composer={
          <Composer
            forPalette
            text={text}
            onTextChange={setText}
            pastes={pastes}
            onPastesChange={setPastes}
            history={browserHistory}
            onSend={sendWithNotes}
            sendLabel={hasNotes ? "Send with notes" : "Send"}
            allowEmpty={hasNotes}
            commands={commands.registry}
            onEdit={commands.clear}
            busy={run.busy}
            onStop={run.runId === null ? undefined : () => stop.mutate()}
            disabledReason={connection === "connected" ? null : "Not connected to golem"}
          />
        }
      />
      {commands.dialogs}
    </>
  );
}
