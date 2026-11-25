import type { ConsentChoice, InboxItem } from "@golem/view";
import { useState } from "react";
import { sendErrorText } from "../../store/errors.ts";
import { usePageActions, useSession } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { ConsentBar } from "./consent-bar.tsx";
import { ShowBrief } from "./show-brief.tsx";

/**
 * The paid question of a helper, in the lead's dock. The question is the helper's own consent item, so the card
 * reads it from the helper's session (it carries the run to answer and the sent and not sent lines) and answers
 * there. Until that session has told it, the card shows the lines of the pending item and "Open helper".
 */
export function HelperConsent({ item, onOpen }: { item: InboxItem; onOpen: (item: InboxItem) => void }) {
  const helperId = item.answerSessionId;
  const consent = useSession(helperId, ({ chat }) => chat.consent);
  const { answerConsent } = usePageActions();
  const [sent, setSent] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (consent === null) {
    const lines = [item.sent.length === 0 ? "" : `Sent: ${item.sent.join(", ")}`, item.notSent.length === 0 ? "" : `Not sent: ${item.notSent.join(", ")}`];
    return (
      <section role="group" aria-label="Paid model" data-consent-bar="" className="rounded-lg border border-line-strong bg-surface px-3 py-3 shadow-soft">
        <p className="text-sm leading-snug font-semibold wrap-anywhere">{item.helper?.name ?? "A helper"} asks</p>
        <p className="mt-0.5 text-sm leading-snug wrap-anywhere">{item.headline}</p>
        {lines
          .filter((line) => line !== "")
          .map((line) => (
            <p key={line} className="mt-0.5 text-sm leading-snug wrap-anywhere" data-consent-sent="">
              {line}
            </p>
          ))}
        <ShowBrief brief={item.brief} diffArtifactId={item.diffArtifactId} sessionId={helperId} />
        <div className="mt-2">
          <Button
            kind="ghost"
            onClick={() => {
              onOpen(item);
            }}
          >
            Open helper
          </Button>
        </div>
      </section>
    );
  }
  return (
    <ConsentBar
      key={consent.runId}
      consent={consent}
      sessionId={helperId}
      sending={sent === consent.runId}
      error={failed}
      onAnswer={(choice: ConsentChoice) => {
        setSent(consent.runId);
        setFailed(null);
        answerConsent(helperId, consent.runId, choice).catch((err: unknown) => {
          setSent(null);
          setFailed(sendErrorText(err));
        });
      }}
    />
  );
}
