import { golemState } from "@golem/view";
import { useMutation } from "@tanstack/react-query";
import { useConnection } from "../../store/connection-context.tsx";
import { sendErrorText } from "../../store/errors.ts";
import { useDraft, useDraftPastes, usePageActions, useSession } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { Composer } from "./composer.tsx";
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

  const send = useMutation({ mutationFn: (message: string) => actions.send(sessionId, message) });
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
  return (
    <DockView
      busy={run.busy}
      error={failure ? sendErrorText(failure) : null}
      meter={<Meter state={state} runStartedAt={run.runStartedAt} />}
      composer={
        <Composer
          text={text}
          onTextChange={setText}
          pastes={pastes}
          onPastesChange={setPastes}
          history={browserHistory}
          onSend={(message) => send.mutateAsync(message)}
          busy={run.busy}
          onStop={run.runId === null ? undefined : () => stop.mutate()}
          disabledReason={connection === "connected" ? null : "Not connected to golem"}
        />
      }
    />
  );
}
