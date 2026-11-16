import { checksQuestion } from "@golem/view";
import { useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { usePageActions, useSession } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";

type Offered = readonly { name: string; command: string }[];

/** The question above the composer: may golem run the project's checks after its edits? */
export function ChecksQuestionView({
  offered,
  onAnswer,
  busy = false,
  error = null,
}: {
  offered: Offered;
  onAnswer: (on: boolean) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const question = checksQuestion(offered);
  return (
    <section aria-label="Run checks?" data-checks-question className="flex flex-col gap-2 rounded-lg border border-line bg-wait-soft px-3 py-2.5 text-sm">
      <p className="text-wait">
        {question.text}{" "}
        {question.commands.map((command, index) => (
          <span key={command}>
            {index === 0 ? null : <span aria-hidden="true"> · </span>}
            <code className="font-mono text-xs">{command}</code>
          </span>
        ))}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          kind="primary"
          size="sm"
          disabled={busy}
          onClick={() => {
            onAnswer(true);
          }}
        >
          Run them
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            onAnswer(false);
          }}
        >
          Not in this chat
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-deny">
          {error}
        </p>
      )}
    </section>
  );
}

const selectOffered = (view: { chat: { checks: { offered: Offered | null; allowed: boolean | null } } }) => {
  const { offered, allowed } = view.chat.checks;
  return allowed === null ? offered : null;
};

/** The question of a session, shown while it has an offer and no answer. Either answer sends `session.set_checks` and closes it. */
export function DockedChecksQuestion({ sessionId }: { sessionId: string }) {
  const offered = useSession(sessionId, selectOffered);
  const actions = usePageActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  if (offered === null || answered) return null;
  return (
    <ChecksQuestionView
      offered={offered}
      busy={busy}
      error={error}
      onAnswer={(on) => {
        setBusy(true);
        setError(null);
        actions.setChecks(sessionId, on).then(
          () => {
            setAnswered(true);
          },
          (failure: unknown) => {
            setBusy(false);
            setError(actionErrorText(failure, "Could not save the answer."));
          },
        );
      }}
    />
  );
}
