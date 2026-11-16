import type { ConsentChoice } from "@golem/view";
import { useCallback, useState } from "react";
import { sendErrorText } from "../../store/errors.ts";
import { usePageActions, useSession } from "../../store/page-context.tsx";
import { CONSENT_CARD_ID } from "../../store/inbox.ts";
import { ConsentBar } from "./consent-bar.tsx";

/**
 * The paid step-up question of a session, docked above its composer. The card closes with the
 * daemon's `route.consent.answered`, so a second client that answers first closes this one too.
 */
export function DockedConsent({ sessionId }: { sessionId: string }) {
  const consent = useSession(sessionId, ({ chat }) => chat.consent);
  const { answerConsent } = usePageActions();
  const [sent, setSent] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ run: string; text: string } | null>(null);
  const run = consent?.runId ?? null;
  const answer = useCallback(
    (choice: ConsentChoice) => {
      if (run === null) return;
      setSent(run);
      setFailed(null);
      answerConsent(sessionId, run, choice).catch((err: unknown) => {
        setSent(null);
        setFailed({ run, text: sendErrorText(err) });
      });
    },
    [answerConsent, sessionId, run],
  );
  if (consent === null) return null;
  return (
    <ConsentBar
      key={consent.runId}
      consent={consent}
      id={CONSENT_CARD_ID}
      sending={sent === consent.runId}
      error={failed !== null && failed.run === consent.runId ? failed.text : null}
      onAnswer={answer}
    />
  );
}
