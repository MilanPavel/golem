import { golemState } from "@golem/view";
import { useMutation } from "@tanstack/react-query";
import { useConnection } from "../../store/connection-context.tsx";
import { sendErrorText } from "../../store/errors.ts";
import { useDraft, useDraftPastes, usePageActions, useSession } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { DockedApproval } from "../approval/docked-approval.tsx";
import { Composer } from "./composer.tsx";
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
  failed: boolean;
};

const selectRun = ({ chat }: SessionView): Run => ({
  busy: chat.busy,
  runId: chat.runId,
  runStartedAt: chat.runStartedAt,
  waiting: chat.approval !== null,
  failed: chat.error !== null,
});

const selectCwd = (view: SessionView) => view.cwd;
const selectActiveSkills = (view: SessionView) => view.chat.activeSkills;

const sameRun = (a: Run, b: Run): boolean =>
  a.busy === b.busy &&
  a.runId === b.runId &&
  a.runStartedAt === b.runStartedAt &&
  a.waiting === b.waiting &&
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
  const stop = useMutation({
    mutationFn: async () => {
      if (run.runId !== null) {
        await actions.cancel(run.runId);
      }
    },
  });

  const phase = run.waiting ? "waiting" : run.busy ? "thinking" : null;
  const state = golemState({ connection, phase, error: run.failed });
  const failure = send.error ?? stop.error;
  const line = commands.error ?? (failure ? sendErrorText(failure) : null);
  return (
    <>
      <DockView
        busy={run.busy}
        error={line}
        notice={commands.notice}
        meter={<Meter state={state} runStartedAt={run.runStartedAt} aside={
              <span className="flex items-center gap-2">
                <TuneChip sessionId={sessionId} />
                <ContextChip sessionId={sessionId} />
              </span>
            } />}
        approval={<DockedApproval sessionId={sessionId} />}
        composer={
          <Composer
            forPalette
            text={text}
            onTextChange={setText}
            pastes={pastes}
            onPastesChange={setPastes}
            history={browserHistory}
            onSend={commands.run}
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
